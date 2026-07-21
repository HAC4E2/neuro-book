import {
    createStoryboardPresetHashes,
    resolveStoryboardReviewState,
    StoryboardPresetSchema,
    type StoryboardPreset,
    type StoryboardReviewState,
} from "nbook/shared/text-to-image-storyboard-preset";
import {
    createTextToImageMarkdownFileHash,
    parseStrictTextToImageFrontmatter,
    renderStrictTextToImageFrontmatter,
} from "nbook/server/text-to-image/strict-frontmatter";

export type ParsedStoryboardPresetMarkdown = {
    preset: StoryboardPreset;
    body: string;
    fileHash: string;
    hashes: ReturnType<typeof createStoryboardPresetHashes>;
    reviewState: StoryboardReviewState;
};

/** 解析 Storyboard Preset Markdown；正文不进入运行合同。 */
export function parseStoryboardPresetMarkdown(markdown: string): ParsedStoryboardPresetMarkdown {
    const document = parseStrictTextToImageFrontmatter(markdown, "Storyboard Preset");
    const preset = StoryboardPresetSchema.parse(document.frontmatter);
    return {
        preset,
        body: document.body,
        fileHash: createStoryboardPresetFileHash(markdown),
        hashes: createStoryboardPresetHashes(preset),
        reviewState: resolveStoryboardReviewState(preset),
    };
}

/** 规范渲染 Storyboard Preset；缺省正文只提供人类维护说明。 */
export function renderStoryboardPresetMarkdown(input: StoryboardPreset, body?: string): string {
    const preset = StoryboardPresetSchema.parse(input);
    return renderStrictTextToImageFrontmatter(preset, body ?? [
        `# ${preset.title}`,
        "",
        "运行时只读取并校验 frontmatter；本段仅供人类解释来源、效果和维护方式。",
        "",
    ].join("\n"));
}

/** 计算完整 Storyboard Markdown 的文件冲突 hash。 */
export function createStoryboardPresetFileHash(markdown: string): string {
    return createTextToImageMarkdownFileHash(markdown);
}
