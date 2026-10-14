import {taskHref} from "./routes.js";

/**
 * Task 页的速览面板（t15 阶段 4 第 2 批，D1）：开着什么写在网址的 `?peek=` 里，能后退、能分享。
 * 写法：`artifact/<产物 id>`、`doc/<checkout>/<仓库路径>`、`evidence/<仓库路径>`。checkout key 与产物 id 里没有 `/`。
 * 读不懂的值当作没开（不报错：网址可能是手抄的）。路径的白名单由服务端核对，这里只挡掉绝对路径与 `..`。
 */
export type Peek =
    | {kind: "artifact"; artifactId: string}
    | {kind: "doc"; checkout: string; path: string}
    | {kind: "evidence"; path: string};

const SAFE_SEGMENT = /^[^/]+$/u;
function safePath(path: string): boolean {
    return path !== "" && !path.startsWith("/") && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function parsePeek(value: unknown): Peek | null {
    if (typeof value !== "string") return null;
    const slash = value.indexOf("/");
    if (slash < 0) return null;
    const kind = value.slice(0, slash);
    const rest = value.slice(slash + 1);
    if (kind === "artifact") return SAFE_SEGMENT.test(rest) ? {kind, artifactId: rest} : null;
    if (kind === "evidence") return safePath(rest) ? {kind, path: rest} : null;
    if (kind === "doc") {
        const next = rest.indexOf("/");
        const checkout = rest.slice(0, next);
        const path = rest.slice(next + 1);
        return next > 0 && safePath(path) ? {kind, checkout, path} : null;
    }
    return null;
}

export function peekValue(peek: Peek): string {
    if (peek.kind === "artifact") return `artifact/${peek.artifactId}`;
    if (peek.kind === "doc") return `doc/${peek.checkout}/${peek.path}`;
    return `evidence/${peek.path}`;
}

/** Task 页带着速览打开的地址（Work 页展开的 Task 里，产物与证据链到这里）。 */
export function taskPeekHref(workId: string, taskId: string, peek: Peek): string {
    return `${taskHref(workId, taskId)}?peek=${encodeURIComponent(peekValue(peek))}`;
}
