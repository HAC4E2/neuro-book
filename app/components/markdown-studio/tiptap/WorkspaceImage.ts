import {Image} from "@tiptap/extension-image";
import {mergeAttributes} from "@tiptap/core";

/**
 * 项目内图片的 src 解析器：
 * - toDisplaySrc：渲染 DOM 时把项目相对路径改写成可访问的 API URL；
 * - toStoredSrc：从 DOM（编辑器内复制/粘贴）回读属性时还原为存储态相对路径。
 * Markdown 序列化始终使用 attrs.src（存储态），不落 API URL。
 */
export type WorkspaceImageSrcResolver = {
    toDisplaySrc: (src: string) => string;
    toStoredSrc: (src: string) => string;
};

/** 宿主未注入解析器时保持库默认行为（src 原样透传）。 */
export const passthroughWorkspaceImageSrcResolver: WorkspaceImageSrcResolver = {
    toDisplaySrc: (src) => src,
    toStoredSrc: (src) => src,
};

type WorkspaceImageOptions = {
    inline: boolean;
    allowBase64: boolean;
    HTMLAttributes: Record<string, string>;
    resolveSrc: WorkspaceImageSrcResolver;
};

/**
 * 覆写官方 Image 节点的 DOM 出入口：
 * 存储真相（attrs.src / markdown destination）保持项目相对路径，仅展示层改写。
 */
export const WorkspaceImage = Image.extend<WorkspaceImageOptions>({
    addOptions() {
        const parent = this.parent?.();
        return {
            inline: parent?.inline ?? false,
            allowBase64: parent?.allowBase64 ?? false,
            HTMLAttributes: parent?.HTMLAttributes ?? {},
            resolveSrc: passthroughWorkspaceImageSrcResolver,
        };
    },

    addAttributes() {
        return {
            ...this.parent?.(),
            src: {
                default: null,
                // 编辑器内复制会经 renderHTML 产出的展示 URL 回流，这里还原为存储态。
                parseHTML: (element) => {
                    const raw = element.getAttribute("src");
                    return raw === null ? null : this.options.resolveSrc.toStoredSrc(raw);
                },
            },
        };
    },

    renderHTML({HTMLAttributes}) {
        const src = typeof HTMLAttributes.src === "string" ? this.options.resolveSrc.toDisplaySrc(HTMLAttributes.src) : HTMLAttributes.src;
        return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {src})];
    },
});
