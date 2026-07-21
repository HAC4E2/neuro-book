import {
    ChapterIllustrationStoryboardSchema,
    type ChapterIllustrationStoryboard,
} from "nbook/shared/text-to-image-chapter-storyboard";
import {
    createTextToImageMarkdownFileHash,
    parseStrictTextToImageFrontmatter,
    renderStrictTextToImageFrontmatter,
} from "nbook/server/text-to-image/strict-frontmatter";

export const DEFAULT_CHAPTER_STORYBOARD_BODY = "# 本章插图计划\n\n本文件正文用于作者阅读、审阅与记录理由；运行时只消费严格 frontmatter。\n";

export type ParsedChapterStoryboardMarkdown = {
    storyboard: ChapterIllustrationStoryboard;
    body: string;
    fileHash: string;
};

/** 解析并完整校验 Chapter Storyboard V2 Markdown。 */
export function parseChapterStoryboardMarkdown(markdown: string): ParsedChapterStoryboardMarkdown {
    const document = parseStrictTextToImageFrontmatter(markdown, "Chapter Storyboard");
    return {
        storyboard: ChapterIllustrationStoryboardSchema.parse(document.frontmatter),
        body: document.body,
        fileHash: createTextToImageMarkdownFileHash(markdown),
    };
}

/** 以 canonical YAML 渲染已闭合且 planHash 有效的 Chapter Storyboard。 */
export function renderChapterStoryboardMarkdown(
    storyboard: ChapterIllustrationStoryboard,
    body: string = DEFAULT_CHAPTER_STORYBOARD_BODY,
): string {
    const parsed = ChapterIllustrationStoryboardSchema.parse(storyboard);
    return renderStrictTextToImageFrontmatter(parsed, body);
}
