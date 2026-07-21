import {
    createTagPatternOverlayHashes,
    resolveTagPatternOverlayReviewState,
    TagPatternOverlaySchema,
    type TagPatternOverlay,
    type TagPatternReviewState,
} from "nbook/shared/text-to-image-tag-pattern";
import {
    createTextToImageMarkdownFileHash,
    parseStrictTextToImageFrontmatter,
    renderStrictTextToImageFrontmatter,
} from "nbook/server/text-to-image/strict-frontmatter";

export type ParsedTagPatternOverlayMarkdown = {
    overlay: TagPatternOverlay;
    body: string;
    fileHash: string;
    hashes: ReturnType<typeof createTagPatternOverlayHashes>;
    reviewState: TagPatternReviewState;
};

/** 解析 Project Tag Pattern overlay；正文不进入 planning/render hash。 */
export function parseTagPatternOverlayMarkdown(markdown: string): ParsedTagPatternOverlayMarkdown {
    const document = parseStrictTextToImageFrontmatter(markdown, "Project Tag Pattern Overlay");
    const overlay = TagPatternOverlaySchema.parse(document.frontmatter);
    return {
        overlay,
        body: document.body,
        fileHash: createTextToImageMarkdownFileHash(markdown),
        hashes: createTagPatternOverlayHashes(overlay),
        reviewState: resolveTagPatternOverlayReviewState(overlay),
    };
}

/** 规范渲染 Project Tag Pattern overlay。 */
export function renderTagPatternOverlayMarkdown(input: TagPatternOverlay, body?: string): string {
    const overlay = TagPatternOverlaySchema.parse(input);
    return renderStrictTextToImageFrontmatter(overlay, body ?? [
        `# ${overlay.patternSetId} 的 Project Pattern 覆盖`,
        "",
        "运行时只读取并校验 frontmatter；本段仅供人类解释局部 Pattern。",
        "",
    ].join("\n"));
}
