import {mergeAttributes, Node} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import {escapeAttribute, unescapeAttribute} from "nbook/shared/markdown-workbench";

export type TextToImagePromptGeneratePayload = {
    id: string;
    prompt: string;
};

type TextToImagePromptOptions = {
    onGenerate: (payload: TextToImagePromptGeneratePayload) => void;
};

interface TextToImagePromptToken extends MarkdownToken {
    id?: string;
    prompt?: string;
}

const TEXT_TO_IMAGE_PROMPT_PATTERN = /^<text-to-image-prompt\s+id="([^"]+)">\n?([\s\S]*?)\n?<\/text-to-image-prompt>/u;

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        textToImagePrompt: {
            insertTextToImagePrompt: (payload: TextToImagePromptGeneratePayload) => ReturnType;
        };
    }
}

/**
 * 正文生图占位块。Markdown 中保存为显式 tag，富文本中显示为可点击的“生成图片”按钮。
 */
export const TextToImagePrompt = Node.create<TextToImagePromptOptions>({
    name: "textToImagePrompt",
    group: "block",
    atom: true,
    selectable: false,
    defining: true,
    priority: 930,

    addOptions() {
        return {
            onGenerate: () => {},
        };
    },

    addAttributes() {
        return {
            id: {
                default: "",
            },
            prompt: {
                default: "",
            },
        };
    },

    parseHTML() {
        return [{
            tag: "text-to-image-prompt[id]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                return {
                    id: unescapeAttribute(element.getAttribute("id") ?? ""),
                    prompt: element.textContent?.trim() ?? "",
                };
            },
        }];
    },

    renderHTML({HTMLAttributes}) {
        const id = String(HTMLAttributes.id ?? "");
        const prompt = String(HTMLAttributes.prompt ?? "");
        return ["text-to-image-prompt", mergeAttributes({id}), prompt];
    },

    addNodeView() {
        return ({node}) => {
            let currentNode = node;
            const wrapper = document.createElement("div");
            wrapper.className = "nb-text-to-image-prompt-node";
            wrapper.contentEditable = "false";

            const button = document.createElement("button");
            button.type = "button";
            button.className = "nb-text-to-image-prompt-button";

            const icon = document.createElement("span");
            icon.className = "i-lucide-image-plus nb-text-to-image-prompt-button__icon";
            icon.setAttribute("aria-hidden", "true");

            const label = document.createElement("span");
            label.textContent = "生成图片";

            button.append(icon, label);
            wrapper.append(button);

            const sync = (): void => {
                const prompt = String(currentNode.attrs.prompt ?? "").trim();
                const id = String(currentNode.attrs.id ?? "").trim();
                button.title = prompt ? `生成图片：${prompt}` : "生成图片";
                button.disabled = !id || !prompt;
                wrapper.dataset.textToImagePromptId = id;
            };
            sync();

            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const id = String(currentNode.attrs.id ?? "").trim();
                const prompt = String(currentNode.attrs.prompt ?? "").trim();
                if (!id || !prompt) {
                    return;
                }
                this.options.onGenerate({id, prompt});
            });

            return {
                dom: wrapper,
                update: (nextNode) => {
                    if (nextNode.type.name !== this.name) {
                        return false;
                    }
                    currentNode = nextNode;
                    sync();
                    return true;
                },
                stopEvent: (event) => event.type === "click" || event.type === "mousedown" || event.type === "mouseup",
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
            return {
                type: "textToImagePrompt",
                raw: matched[0],
                id: unescapeAttribute(matched[1] ?? ""),
                prompt: (matched[2] ?? "").trim(),
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const promptToken = token as TextToImagePromptToken;
        return helpers.createNode("textToImagePrompt", {
            id: promptToken.id ?? "",
            prompt: promptToken.prompt ?? "",
        });
    },

    renderMarkdown: (node) => {
        const id = String(node.attrs?.id ?? "").trim();
        const prompt = String(node.attrs?.prompt ?? "").trim();
        return `<text-to-image-prompt id="${escapeAttribute(id)}">\n${prompt}\n</text-to-image-prompt>`;
    },

    renderText: ({node}) => {
        const prompt = String(node.attrs?.prompt ?? "").trim();
        return prompt ? `[生成图片: ${prompt}]` : "[生成图片]";
    },

    addCommands() {
        return {
            insertTextToImagePrompt: (payload) => ({commands}) => commands.insertContent(renderTextToImagePromptMarkdown(payload), {contentType: "markdown"}),
        };
    },
});

export function renderTextToImagePromptMarkdown(payload: TextToImagePromptGeneratePayload): string {
    return `<text-to-image-prompt id="${escapeAttribute(payload.id)}">\n${payload.prompt.trim()}\n</text-to-image-prompt>`;
}