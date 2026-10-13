import DOMPurify from "dompurify";
import {marked} from "marked";

/**
 * Markdown 渲染：`marked` 转 HTML，DOMPurify 清洗，再改写链接与图片。
 * - 文档与记录都是 Agent 写的：去掉 `style`、表单与控件（能把整页盖住或伪造表单，t10 有了写操作就是 UI 劫持），见 docs/panel.md 的 CSP。
 * - 相对链接按文档所在目录解析成仓库路径：`.md` 转成文档页，产物目录转成产物页，`.agents/works/` 下的其它文件与图片走产物来源；
 *   其余仓库文件面板不提供，链接去掉、图片不显示（单页应用里直接点会落到 index.html）。
 */

export type MarkdownContext = {checkoutKey: string; path: string; artifactBase: string | null};

const FORBID_TAGS = ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"];

function resolveRepoPath(fromPath: string, target: string): string | null {
    const parts = fromPath.split("/").slice(0, -1);
    for (const segment of target.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") {
            if (parts.length === 0) return null;
            parts.pop();
        } else {
            parts.push(segment);
        }
    }
    return parts.join("/");
}

function decode(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch (error) {
        // 不是合法的百分号编码：按字面路径处理。
        if (!(error instanceof URIError)) throw error;
        return text;
    }
}

/** 仓库路径对应的面板地址；没有对应页面时为 null。 */
export function panelLinkFor(repoPath: string, checkoutKey: string, artifactBase: string | null): {href: string; internal: boolean} | null {
    if (repoPath.endsWith(".md")) return {href: `/docs?checkout=${encodeURIComponent(checkoutKey)}&path=${encodeURIComponent(repoPath)}`, internal: true};
    const task = /^\.agents\/works\/([^/]+)\/tasks\/([^/]+)\/artifacts\/([^/]+)(?:\/|$)/u.exec(repoPath);
    if (task) return {href: `/artifact/${task[1]}/${task[2]}/${task[3]}`, internal: true};
    const work = /^\.agents\/works\/([^/]+)\/artifacts\/([^/]+)(?:\/|$)/u.exec(repoPath);
    if (work) return {href: `/artifact/${work[1]}/-/${work[2]}`, internal: true};
    if (repoPath.startsWith(".agents/works/") && artifactBase) return {href: `${artifactBase}/${encodeURIComponent(checkoutKey)}/${repoPath.split("/").map(encodeURIComponent).join("/")}`, internal: false};
    return null;
}

export function renderMarkdown(text: string, context: MarkdownContext): string {
    const html = marked.parse(text, {async: false, gfm: true}) as string;
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
        if (node.tagName === "A") {
            const href = node.getAttribute("href") ?? "";
            if (href === "" || href.startsWith("#")) return;
            if (/^[a-z][a-z0-9+.-]*:/iu.test(href)) {
                node.setAttribute("target", "_blank");
                node.setAttribute("rel", "noopener noreferrer");
                return;
            }
            const [pathPart = ""] = href.split(/[?#]/u);
            const repoPath = href.startsWith("/") ? decode(pathPart.slice(1)) : resolveRepoPath(context.path, decode(pathPart));
            const link = repoPath === null ? null : panelLinkFor(repoPath, context.checkoutKey, context.artifactBase);
            if (!link) {
                node.removeAttribute("href");
                node.setAttribute("title", `面板不提供这个文件：${repoPath ?? href}`);
                return;
            }
            node.setAttribute("href", link.href);
            if (link.internal) node.setAttribute("data-internal", "");
            else {
                node.setAttribute("target", "_blank");
                node.setAttribute("rel", "noopener noreferrer");
            }
        } else if (node.tagName === "IMG") {
            const src = node.getAttribute("src") ?? "";
            if (/^(?:https?:|data:)/iu.test(src)) return;
            const repoPath = src.startsWith("/") ? decode(src.slice(1)) : resolveRepoPath(context.path, decode(src.split(/[?#]/u)[0] ?? ""));
            if (repoPath !== null && repoPath.startsWith(".agents/works/") && context.artifactBase) {
                node.setAttribute("src", `${context.artifactBase}/${encodeURIComponent(context.checkoutKey)}/${repoPath.split("/").map(encodeURIComponent).join("/")}`);
            } else {
                node.removeAttribute("src");
            }
        }
    });
    try {
        return DOMPurify.sanitize(html, {FORBID_TAGS, FORBID_ATTR: ["style"]});
    } finally {
        DOMPurify.removeHook("afterSanitizeAttributes");
    }
}
