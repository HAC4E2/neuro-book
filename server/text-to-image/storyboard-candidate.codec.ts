import {
    createPendingTagPatternHashes,
    PendingTagPatternSetSchema,
    type PendingTagPatternSet,
} from "nbook/shared/text-to-image-storyboard-candidate";
import {
    createTextToImageMarkdownFileHash,
    parseStrictTextToImageFrontmatter,
    renderStrictTextToImageFrontmatter,
} from "nbook/server/text-to-image/strict-frontmatter";

export type ParsedPendingTagPatternMarkdown = {
    patternSet: PendingTagPatternSet;
    body: string;
    fileHash: string;
    hashes: ReturnType<typeof createPendingTagPatternHashes>;
};

/** 解析 pending-only Pattern Markdown；该 codec 不产出正式 TagPatternSet。 */
export function parsePendingTagPatternMarkdown(markdown: string): ParsedPendingTagPatternMarkdown {
    const document = parseStrictTextToImageFrontmatter(markdown, "Pending Tag Pattern");
    const patternSet = PendingTagPatternSetSchema.parse(document.frontmatter);
    return {
        patternSet,
        body: document.body,
        fileHash: createTextToImageMarkdownFileHash(markdown),
        hashes: createPendingTagPatternHashes(patternSet),
    };
}

/** 规范渲染不可批准的 pending Pattern companion。 */
export function renderPendingTagPatternMarkdown(input: PendingTagPatternSet): string {
    const patternSet = PendingTagPatternSetSchema.parse(input);
    return renderStrictTextToImageFrontmatter(patternSet, [
        `# ${patternSet.title}`,
        "",
        "此文件仍含 PendingTagAtom；active Tag index 解析完成前不可批准或发布。",
        "",
    ].join("\n"));
}
