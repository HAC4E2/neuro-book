import {mergeAttributes, Node} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import {escapeAttribute, unescapeAttribute} from "nbook/shared/markdown-workbench";
import type {TextToImageGenerationResult} from "nbook/app/stores/text-to-image";

export type TextToImageResultItem = TextToImageGenerationResult;

export type TextToImageResultPayload = {
    id: string;
    activeIndex: number;
    items: TextToImageResultItem[];
};

export type TextToImageResultOpenPayload = TextToImageResultPayload & {
    source: "viewer" | "actions";
};

type TextToImageResultOptions = {
    onOpenViewer: (payload: TextToImageResultPayload) => void;
    onOpenActions: (payload: TextToImageResultPayload) => void;
};

interface TextToImageResultToken extends MarkdownToken {
    id?: string;
    payload?: TextToImageResultPayload;
}

const TEXT_TO_IMAGE_RESULT_PATTERN = /^<text-to-image-result\s+id="([^"]+)">\n?([\s\S]*?)\n?<\/text-to-image-result>/u;
const resultGenerationStates = new Map<string, "queued" | "running">();
const resultGenerationListeners = new Set<() => void>();

export function setTextToImageResultGenerationState(id: string, state: "idle" | "queued" | "running"): void {
    const normalizedId = id.trim();
    if (!normalizedId) {
        return;
    }
    if (state === "idle") {
        resultGenerationStates.delete(normalizedId);
    } else {
        resultGenerationStates.set(normalizedId, state);
    }
    for (const listener of resultGenerationListeners) {
        listener();
    }
}

function getTextToImageResultGenerationState(id: string): "idle" | "queued" | "running" {
    return resultGenerationStates.get(id.trim()) ?? "idle";
}

function subscribeTextToImageResultGeneration(listener: () => void): () => void {
    resultGenerationListeners.add(listener);
    return () => {
        resultGenerationListeners.delete(listener);
    };
}

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        textToImageResult: {
            insertTextToImageResult: (payload: TextToImageResultPayload) => ReturnType;
        };
    }
}

export const TextToImageResult = Node.create<TextToImageResultOptions>({
    name: "textToImageResult",
    group: "block",
    atom: true,
    selectable: false,
    defining: true,
    priority: 931,

    addOptions() {
        return {
            onOpenViewer: () => {},
            onOpenActions: () => {},
        };
    },

    addAttributes() {
        return {
            id: {
                default: "",
            },
            activeIndex: {
                default: 0,
            },
            items: {
                default: [],
            },
        };
    },

    parseHTML() {
        return [{
            tag: "text-to-image-result[id]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                const id = unescapeAttribute(element.getAttribute("id") ?? "");
                const payload = parseTextToImageResultPayload(id, element.textContent ?? "");
                return {
                    id: payload.id,
                    activeIndex: payload.activeIndex,
                    items: payload.items,
                };
            },
        }];
    },

    renderHTML({HTMLAttributes}) {
        const payload = normalizeTextToImageResultPayload({
            id: String(HTMLAttributes.id ?? ""),
            activeIndex: Number(HTMLAttributes.activeIndex ?? 0),
            items: Array.isArray(HTMLAttributes.items) ? HTMLAttributes.items : [],
        });
        return ["text-to-image-result", mergeAttributes({id: payload.id}), JSON.stringify({
            activeIndex: payload.activeIndex,
            items: payload.items,
        })];
    },

    addNodeView() {
        return ({node}) => {
            let currentNode = node;
            let longPressTimer: number | null = null;
            let longPressTriggered = false;

            const wrapper = document.createElement("figure");
            wrapper.className = "nb-text-to-image-result-node";
            wrapper.contentEditable = "false";

            const imageButton = document.createElement("button");
            imageButton.type = "button";
            imageButton.className = "nb-text-to-image-result-button";

            const image = document.createElement("img");
            image.className = "nb-text-to-image-result-image";
            image.alt = "NovelAI 生成图片";
            image.draggable = false;

            const placeholder = document.createElement("div");
            placeholder.className = "nb-text-to-image-result-placeholder";
            placeholder.textContent = "图片数据不可用";

            const busyOverlay = document.createElement("div");
            busyOverlay.className = "nb-text-to-image-result-busy";
            const busyIcon = document.createElement("span");
            busyIcon.className = "i-lucide-loader-2 nb-text-to-image-result-busy__icon";
            const busyLabel = document.createElement("span");
            busyOverlay.append(busyIcon, busyLabel);

            const caption = document.createElement("figcaption");
            caption.className = "nb-text-to-image-result-caption";

            imageButton.append(image, placeholder, busyOverlay);
            wrapper.append(imageButton, caption);

            const readPayload = (): TextToImageResultPayload => normalizeTextToImageResultPayload({
                id: String(currentNode.attrs.id ?? ""),
                activeIndex: Number(currentNode.attrs.activeIndex ?? 0),
                items: Array.isArray(currentNode.attrs.items) ? currentNode.attrs.items : [],
            });

            const sync = (): void => {
                const payload = readPayload();
                const item = payload.items[payload.activeIndex] ?? payload.items[0] ?? null;
                const imageUrl = item ? resolveTextToImageResultImageUrl(item) : "";
                const generationState = getTextToImageResultGenerationState(payload.id);
                const busy = generationState !== "idle";
                wrapper.dataset.textToImageResultId = payload.id;
                wrapper.dataset.textToImageResultState = generationState;
                imageButton.disabled = !imageUrl || busy;
                imageButton.title = busy
                    ? generationState === "queued" ? "图片请求排队中..." : "正在重新生成图片..."
                    : "点击查看大图，长按查看 tag 和重 roll";
                image.hidden = !imageUrl;
                placeholder.hidden = Boolean(imageUrl);
                if (imageUrl) {
                    image.src = imageUrl;
                } else {
                    image.removeAttribute("src");
                }
                busyOverlay.hidden = !busy;
                busyLabel.textContent = generationState === "queued" ? "排队中..." : "生成中...";
                caption.textContent = payload.items.length > 1
                    ? `NovelAI 生成图片 ${payload.activeIndex + 1}/${payload.items.length}`
                    : "NovelAI 生成图片";
            };
            sync();
            const unsubscribeGenerating = subscribeTextToImageResultGeneration(sync);

            const clearLongPressTimer = (): void => {
                if (longPressTimer) {
                    window.clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            };

            imageButton.addEventListener("pointerdown", (event) => {
                if (event.button !== 0) {
                    return;
                }
                clearLongPressTimer();
                longPressTriggered = false;
                longPressTimer = window.setTimeout(() => {
                    longPressTimer = null;
                    longPressTriggered = true;
                    this.options.onOpenActions(readPayload());
                }, 620);
            });
            imageButton.addEventListener("pointerup", clearLongPressTimer);
            imageButton.addEventListener("pointerleave", clearLongPressTimer);
            imageButton.addEventListener("pointercancel", clearLongPressTimer);
            imageButton.addEventListener("contextmenu", (event) => {
                event.preventDefault();
            });
            imageButton.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                clearLongPressTimer();
                if (longPressTriggered) {
                    longPressTriggered = false;
                    return;
                }
                this.options.onOpenViewer(readPayload());
            });
            imageButton.addEventListener("dblclick", (event) => {
                event.preventDefault();
                event.stopPropagation();
                clearLongPressTimer();
                longPressTriggered = false;
                this.options.onOpenActions(readPayload());
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
                stopEvent: (event) => ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "pointercancel", "contextmenu"].includes(event.type),
                destroy: () => {
                    clearLongPressTimer();
                    unsubscribeGenerating();
                },
            };
        };
    },

    markdownTokenizer: {
        name: "textToImageResult",
        level: "block",
        start(src: string) {
            return src.indexOf("<text-to-image-result");
        },
        tokenize(src: string) {
            const matched = TEXT_TO_IMAGE_RESULT_PATTERN.exec(src);
            if (!matched) {
                return undefined;
            }
            const id = unescapeAttribute(matched[1] ?? "");
            return {
                type: "textToImageResult",
                raw: matched[0],
                id,
                payload: parseTextToImageResultPayload(id, matched[2] ?? ""),
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const resultToken = token as TextToImageResultToken;
        const payload = normalizeTextToImageResultPayload(resultToken.payload ?? {
            id: resultToken.id ?? "",
            activeIndex: 0,
            items: [],
        });
        return helpers.createNode("textToImageResult", {
            id: payload.id,
            activeIndex: payload.activeIndex,
            items: payload.items,
        });
    },

    renderMarkdown: (node) => renderTextToImageResultMarkdown({
        id: String(node.attrs?.id ?? ""),
        activeIndex: Number(node.attrs?.activeIndex ?? 0),
        items: Array.isArray(node.attrs?.items) ? node.attrs.items : [],
    }),

    renderText: ({node}) => {
        const items = Array.isArray(node.attrs?.items) ? node.attrs.items : [];
        return `[NovelAI 生成图片 ${items.length ? `x${items.length}` : ""}]`;
    },

    addCommands() {
        return {
            insertTextToImageResult: (payload) => ({commands}) => commands.insertContent(renderTextToImageResultMarkdown(payload), {contentType: "markdown"}),
        };
    },
});

export function renderTextToImageResultMarkdown(payload: TextToImageResultPayload): string {
    const normalized = normalizeTextToImageResultPayload(payload);
    return `<text-to-image-result id="${escapeAttribute(normalized.id)}">\n${JSON.stringify({
        activeIndex: normalized.activeIndex,
        items: normalized.items.map(serializeTextToImageResultItemForMarkdown),
    }, null, 2)}\n</text-to-image-result>`;
}

export function parseTextToImageResultMarkdown(markdown: string): TextToImageResultPayload | null {
    const matched = TEXT_TO_IMAGE_RESULT_PATTERN.exec(markdown);
    if (!matched) {
        return null;
    }
    return parseTextToImageResultPayload(unescapeAttribute(matched[1] ?? ""), matched[2] ?? "");
}

export function normalizeTextToImageResultPayload(payload: Partial<TextToImageResultPayload>): TextToImageResultPayload {
    const items = Array.isArray(payload.items) ? payload.items.map(normalizeTextToImageResultItem).filter((item) => item.id || item.dataUrl || item.savedPath) : [];
    const maxIndex = Math.max(0, items.length - 1);
    const activeIndex = Number.isFinite(Number(payload.activeIndex))
        ? Math.min(maxIndex, Math.max(0, Math.round(Number(payload.activeIndex))))
        : 0;
    return {
        id: payload.id?.trim() || createTextToImageResultId(),
        activeIndex,
        items,
    };
}

export function resolveTextToImageResultImageUrl(item: Pick<TextToImageResultItem, "id" | "savedPath" | "dataUrl">): string {
    const savedPath = item.savedPath.trim();
    if (savedPath) {
        return `/api/text-to-image/image?path=${encodeURIComponent(savedPath)}&v=${encodeURIComponent(item.id)}`;
    }
    return item.dataUrl;
}

function parseTextToImageResultPayload(id: string, rawValue: string): TextToImageResultPayload {
    try {
        const parsed = JSON.parse(rawValue.trim()) as Partial<TextToImageResultPayload>;
        return normalizeTextToImageResultPayload({
            ...parsed,
            id: parsed.id ?? id,
        });
    } catch {
        return normalizeTextToImageResultPayload({
            id,
            activeIndex: 0,
            items: [],
        });
    }
}

function normalizeTextToImageResultItem(input: Partial<TextToImageGenerationResult>): TextToImageResultItem {
    return {
        id: readString(input.id),
        createdAt: readString(input.createdAt),
        fileName: readString(input.fileName),
        savedPath: readString(input.savedPath),
        dataUrl: readString(input.dataUrl),
        mimeType: readString(input.mimeType, "image/png"),
        byteLength: readNumber(input.byteLength, 0),
        seed: readNumber(input.seed, -1),
        width: readNumber(input.width, 0),
        height: readNumber(input.height, 0),
        model: readString(input.model),
        prompt: readString(input.prompt),
        negativePrompt: readString(input.negativePrompt),
    };
}

function serializeTextToImageResultItemForMarkdown(item: TextToImageResultItem): TextToImageResultItem {
    return {
        ...item,
        dataUrl: item.savedPath.trim() ? "" : item.dataUrl,
    };
}

function readString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function createTextToImageResultId(): string {
    return `tti-result-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
