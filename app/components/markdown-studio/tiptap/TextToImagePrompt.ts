import {mergeAttributes, Node} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import {unescapeAttribute} from "nbook/shared/markdown-workbench";
import {
    parseTextToImagePromptMarkdown,
    renderTextToImagePromptMarkdown as renderStructuredTextToImagePromptMarkdown,
    type TextToImagePromptPayload,
} from "nbook/shared/text-to-image-markdown";
import type {IllustrationPlaceholderState} from "nbook/shared/text-to-image-execution-ui";

/** 点击正文按钮时只把占位符 identity 交给服务端执行入口。 */
export type TextToImagePromptGeneratePayload = {
    placeholderId: string;
};

/** NodeView 仅渲染宿主从服务端解析的短期投影，不保存 Job/Manifest 真相。 */
export type TextToImagePromptPresentation = {
    status: IllustrationPlaceholderState;
    summary: string;
    /** 状态无错误时为空字符串。 */
    errorMessage: string;
};

export type TextToImagePromptController = {
    /** 可视区懒加载 status + 零写入 Preview。 */
    resolve: (payload: TextToImagePromptGeneratePayload) => Promise<TextToImagePromptPresentation>;
    /** 只授权宿主已经展示且仍有效的 Preview。 */
    generate: (payload: TextToImagePromptGeneratePayload) => Promise<TextToImagePromptPresentation>;
};

type TextToImagePromptOptions = {
    controller: TextToImagePromptController;
};

/** 非小说宿主中的明确不可用 controller。 */
export const unavailableTextToImagePromptController: TextToImagePromptController = {
    resolve: async () => ({status: "stale", summary: "当前编辑器未连接插图执行服务", errorMessage: ""}),
    generate: async () => ({status: "stale", summary: "当前编辑器未连接插图执行服务", errorMessage: ""}),
};

interface TextToImagePromptToken extends MarkdownToken {
    id?: string;
    schema?: string;
    shotId?: string;
    shotIntentHash?: string;
    sourceChapterHash?: string;
    anchorId?: string;
    origin?: string;
}

const TEXT_TO_IMAGE_PROMPT_PATTERN = /^<text-to-image-prompt\s+id="([^"]+)">\n?([\s\S]*?)\n?<\/text-to-image-prompt>/u;

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        textToImagePrompt: {
            insertTextToImagePrompt: (payload: TextToImagePromptPayload) => ReturnType;
        };
    }
}

/** V2 正文引用节点；不持有 CompiledRequest 或进程内生成状态。 */
export const TextToImagePrompt = Node.create<TextToImagePromptOptions>({
    name: "textToImagePrompt",
    group: "block",
    atom: true,
    selectable: false,
    defining: true,
    priority: 930,

    addOptions() {
        return {controller: unavailableTextToImagePromptController};
    },

    addAttributes() {
        return {
            id: {default: ""},
            schema: {default: ""},
            shotId: {default: ""},
            shotIntentHash: {default: ""},
            sourceChapterHash: {default: ""},
            anchorId: {default: ""},
            origin: {default: ""},
        };
    },

    parseHTML() {
        return [{
            tag: "text-to-image-prompt[id]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                const id = unescapeAttribute(element.getAttribute("id") ?? "");
                const payload = parseTextToImagePromptMarkdown(`<text-to-image-prompt id="${element.getAttribute("id") ?? ""}">\n${element.textContent?.trim() ?? ""}\n</text-to-image-prompt>`);
                return payload ?? {id};
            },
        }];
    },

    renderHTML({HTMLAttributes}) {
        const id = String(HTMLAttributes.id ?? "");
        return ["text-to-image-prompt", mergeAttributes({id}), JSON.stringify({
            schema: String(HTMLAttributes.schema ?? ""),
            shotId: String(HTMLAttributes.shotId ?? ""),
            shotIntentHash: String(HTMLAttributes.shotIntentHash ?? ""),
            sourceChapterHash: String(HTMLAttributes.sourceChapterHash ?? ""),
            anchorId: String(HTMLAttributes.anchorId ?? ""),
            origin: String(HTMLAttributes.origin ?? ""),
        })];
    },

    addNodeView() {
        return ({node}) => {
            let currentNode = node;
            let currentStatus: IllustrationPlaceholderState = "compiling";
            let requestVersion = 0;
            let visible = false;
            let pollTimer: ReturnType<typeof setTimeout> | null = null;
            const wrapper = document.createElement("div");
            wrapper.className = "nb-text-to-image-prompt-node";
            wrapper.contentEditable = "false";

            const button = document.createElement("button");
            button.type = "button";
            button.className = "nb-text-to-image-prompt-button";
            button.title = "生成图片";

            const icon = document.createElement("span");
            icon.className = "i-lucide-image-plus nb-text-to-image-prompt-button__icon";
            icon.setAttribute("aria-hidden", "true");
            const label = document.createElement("span");
            const summary = document.createElement("span");
            summary.className = "nb-text-to-image-prompt-summary";
            button.append(icon, label);
            wrapper.append(button, summary);

            /** 把有限状态投影成固定文案、图标和按钮可用性。 */
            const render = (presentation: TextToImagePromptPresentation): void => {
                currentStatus = presentation.status;
                wrapper.dataset.textToImagePromptStatus = presentation.status;
                summary.textContent = presentation.errorMessage || presentation.summary;
                button.title = presentation.errorMessage || presentation.summary || statusLabel(presentation.status);
                button.disabled = presentation.status !== "ready";
                button.classList.toggle("is-generating", presentation.status === "compiling" || presentation.status === "running");
                label.textContent = statusLabel(presentation.status);
                icon.className = `${statusIcon(presentation.status)} nb-text-to-image-prompt-button__icon`;
                icon.classList.toggle("nb-text-to-image-prompt-button__icon--spin", presentation.status === "compiling" || presentation.status === "running");
            };

            /** queued/running 只通过服务端状态短轮询，不从页面时钟推断。 */
            const schedulePoll = (): void => {
                if (pollTimer) clearTimeout(pollTimer);
                pollTimer = null;
                if (!visible || (currentStatus !== "queued" && currentStatus !== "running")) return;
                pollTimer = setTimeout(() => void load(), 1_800);
            };

            /** 每次 resolve 都绑定当前 node identity；更新/销毁后的迟到响应不会覆盖 DOM。 */
            const load = async (): Promise<void> => {
                const id = String(currentNode.attrs.id ?? "").trim();
                if (!id) return;
                const version = ++requestVersion;
                render({status: "compiling", summary: "正在读取服务端状态与请求摘要", errorMessage: ""});
                try {
                    const presentation = await this.options.controller.resolve({placeholderId: id});
                    if (version !== requestVersion || id !== String(currentNode.attrs.id ?? "").trim()) return;
                    render(presentation);
                } catch (error) {
                    if (version !== requestVersion) return;
                    render({status: "stale", summary: "读取插图状态失败", errorMessage: error instanceof Error ? error.message : "读取插图状态失败"});
                } finally {
                    if (version === requestVersion) schedulePoll();
                }
            };

            const sync = (): void => {
                const id = String(currentNode.attrs.id ?? "").trim();
                wrapper.dataset.textToImagePromptId = id;
                if (!id) {
                    requestVersion += 1;
                    render({status: "stale", summary: "placeholderId 缺失", errorMessage: ""});
                } else {
                    render({status: "compiling", summary: "进入可视区后准备请求摘要", errorMessage: ""});
                }
            };
            sync();

            button.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const id = String(currentNode.attrs.id ?? "").trim();
                if (!id || currentStatus !== "ready") return;
                const version = ++requestVersion;
                render({status: "compiling", summary: "正在复验并注册图片任务", errorMessage: ""});
                try {
                    const presentation = await this.options.controller.generate({placeholderId: id});
                    if (version !== requestVersion || id !== String(currentNode.attrs.id ?? "").trim()) return;
                    render(presentation);
                } catch (error) {
                    if (version !== requestVersion) return;
                    render({status: "stale", summary: "注册图片任务失败", errorMessage: error instanceof Error ? error.message : "注册图片任务失败"});
                } finally {
                    if (version === requestVersion) schedulePoll();
                }
            });

            const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
                visible = entries.some((entry) => entry.isIntersecting);
                if (visible) void load();
                else if (pollTimer) {
                    clearTimeout(pollTimer);
                    pollTimer = null;
                }
            }, {rootMargin: "160px 0px"});
            if (observer) observer.observe(wrapper);
            else {
                visible = true;
                void load();
            }

            return {
                dom: wrapper,
                update: (nextNode) => {
                    if (nextNode.type.name !== this.name) return false;
                    const previousId = String(currentNode.attrs.id ?? "").trim();
                    currentNode = nextNode;
                    sync();
                    if (visible && previousId !== String(nextNode.attrs.id ?? "").trim()) void load();
                    return true;
                },
                stopEvent: (event) => event.type === "click" || event.type === "mousedown" || event.type === "mouseup",
                destroy: () => {
                    requestVersion += 1;
                    observer?.disconnect();
                    if (pollTimer) clearTimeout(pollTimer);
                },
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
            if (!matched) return undefined;
            const payload = parseTextToImagePromptMarkdown(matched[0]);
            if (!payload) return undefined;
            return {type: "textToImagePrompt", raw: matched[0], ...payload};
        },
    },

    parseMarkdown: (token, helpers) => {
        const promptToken = token as TextToImagePromptToken;
        return helpers.createNode("textToImagePrompt", {
            id: promptToken.id ?? "",
            schema: promptToken.schema ?? "",
            shotId: promptToken.shotId ?? "",
            shotIntentHash: promptToken.shotIntentHash ?? "",
            sourceChapterHash: promptToken.sourceChapterHash ?? "",
            anchorId: promptToken.anchorId ?? "",
            origin: promptToken.origin ?? "",
        });
    },

    renderMarkdown: (node) => renderTextToImagePromptMarkdown({
        id: String(node.attrs?.id ?? ""),
        schema: "nbook.text-to-image-prompt/v2",
        shotId: String(node.attrs?.shotId ?? ""),
        shotIntentHash: String(node.attrs?.shotIntentHash ?? ""),
        sourceChapterHash: String(node.attrs?.sourceChapterHash ?? ""),
        anchorId: String(node.attrs?.anchorId ?? ""),
        origin: node.attrs?.origin === "chapter-plan" ? "chapter-plan" : "selection",
    }),

    renderText: () => "[生成图片]",

    addCommands() {
        return {
            insertTextToImagePrompt: (payload) => ({commands}) => commands.insertContent(
                renderTextToImagePromptMarkdown(payload),
                {contentType: "markdown"},
            ),
        };
    },
});

/** 为编辑器命令渲染 canonical V2 placeholder。 */
export function renderTextToImagePromptMarkdown(payload: TextToImagePromptPayload): string {
    return renderStructuredTextToImagePromptMarkdown(payload);
}

/** Placeholder 有限状态的固定按钮文案。 */
function statusLabel(status: IllustrationPlaceholderState): string {
    return {
        ready: "生成图片",
        stale: "插图已过期",
        compiling: "准备中",
        queued: "已排队",
        running: "生成中",
        failed: "生成失败",
        outcome_unknown: "结果未知",
    }[status];
}

/** Placeholder 有限状态的固定图标。 */
function statusIcon(status: IllustrationPlaceholderState): string {
    return {
        ready: "i-lucide-image-plus",
        stale: "i-lucide-shield-alert",
        compiling: "i-lucide-loader-2",
        queued: "i-lucide-clock-3",
        running: "i-lucide-loader-2",
        failed: "i-lucide-circle-x",
        outcome_unknown: "i-lucide-circle-help",
    }[status];
}
