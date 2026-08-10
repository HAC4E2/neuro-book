import {mergeAttributes, Node} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import {
    parseTextToImagePromptMarkdown,
    renderTextToImagePromptMarkdown as renderStructuredTextToImagePromptMarkdown,
    type TextToImagePromptPayload,
} from "nbook/shared/text-to-image-markdown";

export interface TextToImagePromptOptions {
    /** 点击“生成图片”按钮时回调当前占位符 payload */
    onGenerate?: (payload: TextToImagePromptPayload) => void | Promise<void>;
}

interface TextToImagePromptToken extends MarkdownToken {
    id?: string;
    schema?: string;
    prompt?: string;
    negativePrompt?: string;
    anchor?: string;
    title?: string;
    size?: string;
    tagThink?: string;
}

const TEXT_TO_IMAGE_PROMPT_PATTERN = /^<text-to-image-prompt\s+id="([^"]+)">\n?([\s\S]*?)\n?<\/text-to-image-prompt>/u;

/**
 * 正文插图占位符节点：Markdown 侧保存结构化 v1 payload，
 * NodeView 侧渲染“生成图片”卡片并把完整 payload 交给宿主回调。
 */
export const TextToImagePrompt = Node.create<TextToImagePromptOptions>({
    name: "textToImagePrompt",
    group: "block",
    atom: true,
    selectable: false,
    defining: true,
    priority: 930,

    addOptions() {
        return {onGenerate: undefined};
    },

    addAttributes() {
        return {
            id: {default: ""},
            schema: {default: "nbook.text-to-image-prompt/v1"},
            prompt: {default: ""},
            negativePrompt: {default: ""},
            anchor: {default: ""},
            title: {default: ""},
            size: {default: ""},
            tagThink: {default: ""},
        };
    },

    parseHTML() {
        return [{
            tag: "text-to-image-prompt[id]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                const id = element.getAttribute("id") ?? "";
                const payload = parseTextToImagePromptMarkdown(
                    `<text-to-image-prompt id="${id}">\n${element.textContent?.trim() ?? ""}\n</text-to-image-prompt>`,
                );
                return payload ? textToImagePromptAttrsFromPayload(payload) : {id};
            },
        }];
    },

    renderHTML({HTMLAttributes}) {
        const id = String(HTMLAttributes.id ?? "");
        return ["text-to-image-prompt", mergeAttributes({id}), JSON.stringify({
            schema: "nbook.text-to-image-prompt/v1",
            prompt: String(HTMLAttributes.prompt ?? ""),
            negativePrompt: String(HTMLAttributes.negativePrompt ?? ""),
            anchor: String(HTMLAttributes.anchor ?? ""),
            title: String(HTMLAttributes.title ?? ""),
            size: String(HTMLAttributes.size ?? ""),
            tagThink: String(HTMLAttributes.tagThink ?? ""),
        })];
    },

    addNodeView() {
        return ({node}) => {
            let currentNode = node;
            const wrapper = document.createElement("div");
            wrapper.className = "nb-text-to-image-prompt-node";
            wrapper.contentEditable = "false";

            const title = document.createElement("span");
            title.className = "nb-text-to-image-prompt-title";

            const status = document.createElement("span");
            status.className = "nb-text-to-image-prompt-status";
            status.textContent = "待生成";
            let generating = false;

            const button = document.createElement("button");
            button.type = "button";
            button.className = "nb-text-to-image-prompt-button";
            button.textContent = "生成图片";
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (generating) return;
                generating = true;
                render();
                try {
                    await this.options.onGenerate?.(textToImagePromptPayloadFromAttrs(currentNode.attrs));
                } catch {
                    // 宿主负责通知用户；节点只负责回到可重新提交状态。
                } finally {
                    generating = false;
                    render();
                }
            });

            const render = (): void => {
                title.textContent = String(currentNode.attrs.title || "正文插图");
                status.textContent = generating ? "排队或生成中" : "待生成";
                button.disabled = generating;
            };
            render();
            wrapper.append(title, status, button);

            return {
                dom: wrapper,
                update: (nextNode) => {
                    if (nextNode.type.name !== this.name) {
                        return false;
                    }
                    currentNode = nextNode;
                    render();
                    return true;
                },
                stopEvent: (event) => event.type === "click" || event.type === "mousedown" || event.type === "mouseup",
                ignoreMutation: () => true,
            };
        };
    },

    markdownTokenizer: {
        name: "textToImagePrompt",
        level: "block",
        start(src: string) {
            return src.indexOf("<text-to-image-prompt");
        },
        tokenize(src: string) {
            const matched = TEXT_TO_IMAGE_PROMPT_PATTERN.exec(src);
            if (!matched) {
                return undefined;
            }
            const payload = parseTextToImagePromptMarkdown(matched[0]);
            if (!payload) {
                return undefined;
            }
            return {type: "textToImagePrompt", raw: matched[0], ...payload};
        },
    },

    parseMarkdown: (token, helpers) => {
        const promptToken = token as TextToImagePromptToken;
        return helpers.createNode("textToImagePrompt", textToImagePromptAttrsFromPayload({
            id: promptToken.id ?? "",
            schema: "nbook.text-to-image-prompt/v1",
            prompt: promptToken.prompt ?? "",
            negativePrompt: promptToken.negativePrompt ?? "",
            anchor: promptToken.anchor ?? "",
            title: promptToken.title ?? "",
            size: promptToken.size ?? "",
            tagThink: promptToken.tagThink ?? "",
        }));
    },

    renderMarkdown: (node) => renderStructuredTextToImagePromptMarkdown(
        textToImagePromptPayloadFromAttrs(node.attrs ?? {}),
    ),
});

/** 从 ProseMirror attrs 还原结构化 payload，缺失字段使用空字符串。 */
function textToImagePromptPayloadFromAttrs(attrs: Record<string, unknown>): TextToImagePromptPayload {
    return {
        id: String(attrs.id ?? ""),
        schema: "nbook.text-to-image-prompt/v1",
        prompt: String(attrs.prompt ?? ""),
        negativePrompt: String(attrs.negativePrompt ?? ""),
        anchor: String(attrs.anchor ?? ""),
        title: String(attrs.title ?? ""),
        size: String(attrs.size ?? ""),
        tagThink: String(attrs.tagThink ?? ""),
    };
}

/** 把结构化 payload 摊平成节点 attrs。 */
function textToImagePromptAttrsFromPayload(payload: TextToImagePromptPayload): Record<string, string> {
    return {
        id: payload.id,
        schema: payload.schema,
        prompt: payload.prompt,
        negativePrompt: payload.negativePrompt,
        anchor: payload.anchor,
        title: payload.title,
        size: payload.size,
        tagThink: payload.tagThink,
    };
}
