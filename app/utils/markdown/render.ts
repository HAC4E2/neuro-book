import {Marked} from "marked";
import {renderReferenceChipHtml} from "nbook/app/components/common/reference-chip";
import {renderInlineCommentHtml} from "nbook/app/utils/structured-text";
import {parseWorkspaceReferenceLink} from "nbook/shared/workspace-reference";

/**
 * 转义 HTML。
 */
export const escapeHtml = (unsafeString: string): string => unsafeString
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

/**
 * 计算未闭合的代码块数量。
 */
export const countCodeFences = (text: string): number => {
    const matches = text.match(/^```/gm);
    return matches ? matches.length : 0;
};

/**
 * 处理由于流式接收导致的 Markdown 未闭合代码块问题。
 */
export const normalizeStreamingMarkdown = (text: string): string => {
    const lines = text.split("\n");
    let markdown = lines.join("\n");
    const openFences = countCodeFences(markdown);
    if (openFences % 2 !== 0) {
        markdown += "\n```";
    }
    return markdown;
};

/**
 * 简单渲染纯文本回车为 HTML。
 */
export const renderPlainTextHtml = (text: string): string => {
    return `<div class="whitespace-pre-wrap">${escapeHtml(text)}</div>`;
};

let markedInitialized = false;
const agentMarkdown = new Marked();
const WORKSPACE_REFERENCE_PATTERN = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/;

/**
 * 初始化 Agent 聊天气泡专用 markdown 渲染器。
 */
function ensureMarked(): void {
    if (markedInitialized) {
        return;
    }

    const renderer = new agentMarkdown.Renderer();
    renderer.link = ({href, title, text}) => {
        const rawLink = `[${text}](${href ?? ""})`;
        const reference = parseWorkspaceReferenceLink(rawLink);
        if (reference) {
            return renderReferenceChipHtml(reference);
        }

        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(href ?? "")}"${titleAttr}>${text}</a>`;
    };

    agentMarkdown.setOptions({
        gfm: true,
        breaks: true,
        renderer,
    });
    agentMarkdown.use({
        extensions: [
            {
                name: "workspaceReference",
                level: "inline",
                start(src: string) {
                    return src.indexOf("[");
                },
                tokenizer(src: string) {
                    const matched = WORKSPACE_REFERENCE_PATTERN.exec(src);
                    const rawLink = matched?.[0] ?? "";
                    const reference = rawLink ? parseWorkspaceReferenceLink(rawLink) : null;
                    if (!matched || !reference) {
                        return undefined;
                    }

                    return {
                        type: "workspaceReference",
                        raw: rawLink,
                        href: reference.target,
                        text: reference.label,
                    };
                },
                renderer(token) {
                    const rawLink = token.raw || `[${token.text ?? ""}](${token.href ?? ""})`;
                    const reference = parseWorkspaceReferenceLink(rawLink);
                    if (!reference) {
                        return rawLink;
                    }

                    return renderReferenceChipHtml(reference);
                },
            },
            {
                name: "inlineComment",
                level: "inline",
                start(src: string) {
                    return src.indexOf("<inline-comment");
                },
                tokenizer(src: string) {
                    const matched = /^<inline-comment(?:\s+[^>]*)?>[\s\S]*?<\/inline-comment>/.exec(src);
                    if (!matched) {
                        return undefined;
                    }

                    return {
                        type: "inlineComment",
                        raw: matched[0],
                        text: matched[0],
                    };
                },
                renderer(token) {
                    return renderInlineCommentHtml(token.raw);
                },
            },
        ],
    });
    markedInitialized = true;
}

/**
 * 渲染 Markdown。
 */
export const renderMarkdown = (content: string, sanitizeHtml?: (html: string) => string): string => {
    if (!content.trim()) {
        return "";
    }

    ensureMarked();
    const html = agentMarkdown.parse(normalizeStreamingMarkdown(content)) as string;
    return sanitizeHtml ? sanitizeHtml(html) : html;
};
