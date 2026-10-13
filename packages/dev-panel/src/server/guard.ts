export {guardedFile} from "../core/paths.js";

/**
 * 两个来源共用的请求校验与路径守卫。校验失败一律 4xx，不进业务逻辑。
 * 只绑回环，但回环对本机其他账户与浏览器里的任意网页都开放：
 * - 带转发头的拒绝（跨设备上线之前不接受经代理转进来的请求，t13 再开）；
 * - `Host` 必须是本来源（防 DNS 重绑定：Bun 会按 `Host` 头拼出 `req.url`，只能直接比 `Host` 头）；
 * - 面板来源的 `/api/*` 与 `/ws` 另要登录、要 `Sec-Fetch-Site` 是同源或没有（见 serve.ts）。
 */

export type Rejection = {status: number; code: string; message: string};

const FORWARD_HEADERS = ["forwarded", "x-real-ip", "tailscale-user-login", "tailscale-user-name"];

export function rejectForwarded(headers: Headers): Rejection | null {
    for (const [name] of headers) {
        const lower = name.toLowerCase();
        if (FORWARD_HEADERS.includes(lower) || lower.startsWith("x-forwarded-")) return {status: 403, code: "forwarded", message: `不接受经代理转发的请求（${lower}）`};
    }
    return null;
}

/** 本来源允许的 `Host`：`127.0.0.1`、`localhost`、`[::1]` 加端口。 */
export function allowedHosts(port: number): string[] {
    return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

export function rejectHost(headers: Headers, port: number): Rejection | null {
    const host = headers.get("host");
    return host !== null && allowedHosts(port).includes(host.toLowerCase()) ? null : {status: 421, code: "bad_host", message: "Host 不是本面板"};
}

/** 同一种主机名换端口：请求是 `localhost:4400` 时，产物来源用 `localhost:4401`。 */
export function sameHostOn(host: string, port: number): string {
    const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.slice(0, host.lastIndexOf(":"));
    return `${name}:${port}`;
}

/**
 * 把 URL 的路径拆成段并逐段解码。不合法的百分号编码、解码出 NUL 或 `/`、`.`、`..`、空段都拒绝（400），
 * 不让 URIError 变成 500。`trailingSlash` 时允许末尾一个空段（目录形式的地址）。
 */
export function decodePath(pathname: string): {segments: string[]} | Rejection {
    const raw = pathname.split("/").slice(1);
    const segments: string[] = [];
    for (const [index, piece] of raw.entries()) {
        if (piece === "" && index === raw.length - 1 && index > 0) continue;
        let decoded: string;
        try {
            decoded = decodeURIComponent(piece);
        } catch (error) {
            if (!(error instanceof URIError)) throw error;
            return {status: 400, code: "bad_path", message: "路径里有不合法的百分号编码"};
        }
        if (decoded === "" && raw.length === 1) continue;
        if (decoded === "" || decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) {
            return {status: 400, code: "bad_path", message: "路径里有不合法的段"};
        }
        segments.push(decoded);
    }
    return {segments};
}

/** 静态资源与产物文件的 Content-Type（只认常见的几种，其余按二进制下载）。 */
export function contentType(path: string): string {
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const types: Record<string, string> = {
        html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
        json: "application/json; charset=utf-8", md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
        jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", map: "application/json",
    };
    return types[extension] ?? "application/octet-stream";
}
