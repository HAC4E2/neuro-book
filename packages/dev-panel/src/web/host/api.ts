/**
 * 面板接口的取数：外壳 `{schema, ok, data, warnings, errors, instance, revisions}`，见 docs/panel.md 的“接口”。
 * 只有数据宿主（`panel-data.ts`）与页面经这里取数，零件不碰它。
 */

export type PartName = "records" | "activity" | "sessions" | "notify" | "github";
export type Revisions = Record<PartName, number>;
export type ApiWarning = {code: string; message: string; details?: Record<string, unknown>};
export type Envelope<T> = {schema: string; ok: boolean; data: T; warnings: ApiWarning[]; errors: Array<{code: string; message: string; details?: Record<string, unknown>}>; instance: string; revisions: Revisions};

/**
 * 接口的失败。写接口的失败要带 `details`（差异、`currentHash`、`writtenPaths`）与 `data`（提交失败时的结果），界面据此给出差异与补救办法。
 * `status` 为 0 是连不上或连接中途断开：写请求的结果未知。
 */
export class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}, readonly data: unknown = null, readonly warnings: ApiWarning[] = []) {
        super(message);
        this.name = "ApiError";
    }
}

async function readEnvelope<T>(response: Response): Promise<Envelope<T>> {
    let body: Envelope<T> | null = null;
    try {
        body = await response.json() as Envelope<T>;
    } catch {
        throw new ApiError(response.status, "bad_response", `面板的回应不是 JSON（HTTP ${response.status}）`);
    }
    if (!response.ok || !body.ok) {
        const first = body.errors[0];
        throw new ApiError(response.status, first?.code ?? "http_error", first?.message ?? `HTTP ${response.status}`, first?.details ?? {}, body.data ?? null, body.warnings ?? []);
    }
    return body;
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<Envelope<T>> {
    let response: Response;
    try {
        response = await fetch(path, {signal, headers: {Accept: "application/json"}});
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new ApiError(0, "network", "连不上面板：它可能已经退出，在终端重新运行 nbdev panel serve");
    }
    return readEnvelope<T>(response);
}

function csrfToken(): string {
    return document.querySelector<HTMLMetaElement>('meta[name="nbdev-csrf"]')?.content ?? "";
}

/** 写请求与预览：JSON 请求体，带 CSRF 头（令牌在 index.html 里，服务端还要求同源与登录）。只有页面（宿主）调它，零件不发请求。 */
export async function sendJson<T>(method: "POST" | "PUT", path: string, body: unknown): Promise<Envelope<T>> {
    let response: Response;
    try {
        response = await fetch(path, {method, headers: {"Content-Type": "application/json", Accept: "application/json", "X-Nbdev-Csrf": csrfToken()}, body: JSON.stringify(body)});
    } catch (error) {
        throw new ApiError(0, "network", `连不上面板或连接中途断开（${error instanceof Error ? error.message : String(error)}）`);
    }
    return readEnvelope<T>(response);
}

/** 按行读 NDJSON；被打断（`signal`）时静静结束。 */
export async function streamLines(path: string, onLine: (line: Record<string, unknown>) => void, signal: AbortSignal): Promise<void> {
    const response = await fetch(path, {signal});
    if (!response.ok) {
        let code = "http_error";
        let message = `HTTP ${response.status}`;
        try {
            const body = await response.json() as Envelope<unknown>;
            code = body.errors[0]?.code ?? code;
            message = body.errors[0]?.message ?? message;
        } catch {
            // 回应不是 JSON：用 HTTP 状态码作说明。
        }
        throw new ApiError(response.status, code, message);
    }
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
        const {value, done} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line !== "") onLine(JSON.parse(line) as Record<string, unknown>);
            newline = buffer.indexOf("\n");
        }
    }
}
