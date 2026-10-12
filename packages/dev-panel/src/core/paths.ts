/**
 * 面板读文件、产物来源与搜索结果共用的段检查：路径相对某个 checkout 的根，逐段检查，任何一段不合格就拒绝。
 * 文件接口另有白名单（文档树、产物目录），这里是兜底：哪怕白名单出了错，也不会给出 Git 内部、依赖、密钥与本机数据。
 */

/** 仓库根下只放本机数据的目录：已被 .gitignore 忽略，但某些 checkout 可能没有忽略规则。 */
const LOCAL_TOP_LEVEL = new Set([".local", "workspace", "logs", "server"]);

/** 不合格时返回原因，合格返回 null。`path` 已经解码，用 `/` 分隔，不以 `/` 开头。 */
export function unsafePathReason(path: string): string | null {
    if (path === "") return "empty";
    if (path.includes("\0")) return "nul";
    if (path.startsWith("/") || path.includes("\\")) return "absolute";
    const segments = path.split("/");
    for (const segment of segments) {
        if (segment === "" || segment === "." || segment === "..") return "traversal";
        if (segment === ".git" || segment === "node_modules") return "forbidden_segment";
        if (segment.toLowerCase().startsWith(".env")) return "secret";
    }
    if (LOCAL_TOP_LEVEL.has(segments[0]!)) return "local_data";
    return null;
}

export function isSafeRelativePath(path: string): boolean {
    return unsafePathReason(path) === null;
}
