import {
    createStoryboardOverlaySemanticHash,
    resolveStoryboardOverlayReviewState,
    StoryboardOverlaySchema,
    type StoryboardOverlay,
    type StoryboardReviewState,
} from "nbook/shared/text-to-image-storyboard-preset";
import {
    createTextToImageMarkdownFileHash,
    parseStrictTextToImageFrontmatter,
    renderStrictTextToImageFrontmatter,
} from "nbook/server/text-to-image/strict-frontmatter";

export type ParsedStoryboardOverlayMarkdown = {
    overlay: StoryboardOverlay;
    body: string;
    fileHash: string;
    semanticHash: string;
    reviewState: StoryboardReviewState;
};

/** 解析 Project Storyboard overlay；正文不进入语义或批准状态。 */
export function parseStoryboardOverlayMarkdown(markdown: string): ParsedStoryboardOverlayMarkdown {
    const document = parseStrictTextToImageFrontmatter(markdown, "Project Storyboard Overlay");
    const overlay = StoryboardOverlaySchema.parse(document.frontmatter);
    return {
        overlay,
        body: document.body,
        fileHash: createTextToImageMarkdownFileHash(markdown),
        semanticHash: createStoryboardOverlaySemanticHash(overlay),
        reviewState: resolveStoryboardOverlayReviewState(overlay),
    };
}

/** 规范渲染 Project Storyboard overlay。 */
export function renderStoryboardOverlayMarkdown(input: StoryboardOverlay, body?: string): string {
    const overlay = StoryboardOverlaySchema.parse(input);
    return renderStrictTextToImageFrontmatter(overlay, body ?? [
        `# ${overlay.presetId} 的 Project 分镜覆盖`,
        "",
        "运行时只读取并校验 frontmatter；本段仅供人类解释局部规则。",
        "",
    ].join("\n"));
}
