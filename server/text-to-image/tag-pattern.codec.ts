import {
    createTagPatternSetHashes,
    resolveTagPatternReviewState,
    TagPatternSetSchema,
    type TagPatternReviewState,
    type TagPatternSet,
} from "nbook/shared/text-to-image-tag-pattern";
import {
    createTextToImageMarkdownFileHash,
    parseStrictTextToImageFrontmatter,
    renderStrictTextToImageFrontmatter,
} from "nbook/server/text-to-image/strict-frontmatter";

export type ParsedTagPatternMarkdown = {
    patternSet: TagPatternSet;
    body: string;
    fileHash: string;
    hashes: ReturnType<typeof createTagPatternSetHashes>;
    reviewState: TagPatternReviewState;
};

/** 解析 Tag Pattern Markdown；正文和中文 trigger 都不会被当作 Prompt。 */
export function parseTagPatternMarkdown(markdown: string): ParsedTagPatternMarkdown {
    const document = parseStrictTextToImageFrontmatter(markdown, "Tag Pattern");
    const patternSet = TagPatternSetSchema.parse(document.frontmatter);
    return {
        patternSet,
        body: document.body,
        fileHash: createTagPatternFileHash(markdown),
        hashes: createTagPatternSetHashes(patternSet),
        reviewState: resolveTagPatternReviewState(patternSet),
    };
}

/** 规范渲染 Tag Pattern companion，允许 `patterns: []`。 */
export function renderTagPatternMarkdown(input: TagPatternSet, body?: string): string {
    const patternSet = TagPatternSetSchema.parse(input);
    return renderStrictTextToImageFrontmatter(patternSet, body ?? [
        `# ${patternSet.title}`,
        "",
        "运行时只读取并校验 frontmatter；本段仅供人类审查组合来源与适用范围。",
        "",
    ].join("\n"));
}

/** 计算完整 Tag Pattern Markdown 的文件冲突 hash。 */
export function createTagPatternFileHash(markdown: string): string {
    return createTextToImageMarkdownFileHash(markdown);
}
