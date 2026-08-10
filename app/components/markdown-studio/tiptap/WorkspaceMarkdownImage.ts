import {mergeAttributes} from "@tiptap/core";
import {Image} from "@tiptap/extension-image";

export type WorkspaceImageUrlResolver = (relativePath: string) => string;

export function isWorkspaceImagePath(value: string): boolean {
    return value.trim().replaceAll("\\", "/").startsWith("assets/tti/");
}

export function buildWorkspaceImageUrl(projectRoot: string, relativePath: string): string {
    return `/api/text-to-image/assets/by-path/content?projectRoot=${encodeURIComponent(projectRoot)}&relativePath=${encodeURIComponent(relativePath)}`;
}

export function createWorkspaceMarkdownImage(resolveWorkspaceImageUrl?: WorkspaceImageUrlResolver) {
    return Image.extend({
        renderHTML({HTMLAttributes}) {
            const attributes = {...HTMLAttributes};
            const source = typeof attributes.src === "string" ? attributes.src : "";
            if (resolveWorkspaceImageUrl && isWorkspaceImagePath(source)) {
                attributes["data-workspace-src"] = source;
                attributes.src = resolveWorkspaceImageUrl(source);
            }
            return ["img", mergeAttributes(attributes)];
        },
    }).configure({
        inline: true,
        allowBase64: false,
        HTMLAttributes: {
            class: "nb-markdown-image-node",
        },
    });
}
