import {lstat, realpath} from "node:fs/promises";
import {relative, resolve, sep} from "node:path";
import {systemErrorCode} from "./errors.js";

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

/**
 * 守卫：`relativePath` 相对 `root`，先做段检查；`realpath` 之后必须仍在根下，并对真实路径的相对部分再做一遍段检查
 * （仓库里一个指向 `.git/config` 或 `.env` 的符号链接，两条都能挡住）。只返回普通文件。不合格返回 null。
 * 面板读文件的地方（文档、Task README、产物来源、静态资源）都经它。
 */
export async function guardedFile(root: string, relativePath: string, requirePrefix: string | null = null): Promise<string | null> {
    if (unsafePathReason(relativePath) !== null) return null;
    if (requirePrefix !== null && !relativePath.startsWith(requirePrefix)) return null;
    let real: string;
    let realRoot: string;
    try {
        [real, realRoot] = await Promise.all([realpath(resolve(root, relativePath)), realpath(root)]);
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR" || systemErrorCode(error) === "ELOOP") return null;
        throw error;
    }
    const inside = relative(realRoot, real);
    if (inside === "" || inside.startsWith(`..${sep}`) || inside === ".." || unsafePathReason(inside.split(sep).join("/")) !== null) return null;
    if (requirePrefix !== null && !inside.split(sep).join("/").startsWith(requirePrefix)) return null;
    const stats = await lstat(real);
    return stats.isFile() ? real : null;
}
