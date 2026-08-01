import {
    canonicalizeCharacterImageTags,
    canonicalizeOutfitTags,
    CharacterImageTagsSchema,
    createCharacterImageTagHashes,
    createOutfitTagHashes,
    OutfitTagsSchema,
    type CharacterImageTagHashes,
    type CharacterImageTags,
    type OutfitTags,
} from "nbook/shared/text-to-image-character-visual";
import {
    createTextToImageMarkdownFileHash,
    parseStrictTextToImageFrontmatter,
    renderStrictTextToImageFrontmatter,
} from "nbook/server/text-to-image/strict-frontmatter";

export type ParsedCharacterImageTagsMarkdown = {
    character: CharacterImageTags;
    body: string;
    fileHash: string;
    hashes: CharacterImageTagHashes;
};

export type ParsedOutfitTagsMarkdown = {
    outfit: OutfitTags;
    body: string;
    fileHash: string;
    hashes: CharacterImageTagHashes;
};

/** 解析严格 Character Image Tags V2；旧 Markdown 只能交给 migration intake。 */
export function parseCharacterImageTagsMarkdown(markdown: string): ParsedCharacterImageTagsMarkdown {
    const document = parseStrictTextToImageFrontmatter(markdown, "Character Image Tags V2");
    const character = canonicalizeCharacterImageTags(CharacterImageTagsSchema.parse(document.frontmatter));
    return {
        character,
        body: document.body,
        fileHash: createCharacterImageTagsFileHash(markdown),
        hashes: createCharacterImageTagHashes(character),
    };
}

/** 规范渲染 Character Image Tags V2；正文只供作者解释。 */
export function renderCharacterImageTagsMarkdown(input: CharacterImageTags, body?: string): string {
    const character = canonicalizeCharacterImageTags(input);
    return renderStrictTextToImageFrontmatter({
        schema: character.schema,
        characterId: character.characterId,
        names: character.names,
        resolutionScope: character.resolutionScope,
        fields: character.fields,
        outfitRefs: character.outfitRefs,
        fieldProviderSyntaxRefs: character.fieldProviderSyntaxRefs,
        providerSyntaxNodes: character.providerSyntaxNodes,
        tagResolutions: character.tagResolutions,
        policyApprovals: character.policyApprovals,
    }, body ?? [
        "# 角色生图资料",
        "",
        "运行时只读取并校验 frontmatter；本段仅供作者解释视觉资料来源与人工调整理由。",
        "",
    ].join("\n"));
}

/** 解析严格 Outfit Tags V2；owner 与文件路径一致性由 Project service 继续校验。 */
export function parseOutfitTagsMarkdown(markdown: string): ParsedOutfitTagsMarkdown {
    const document = parseStrictTextToImageFrontmatter(markdown, "Outfit Tags V2");
    const outfit = canonicalizeOutfitTags(OutfitTagsSchema.parse(document.frontmatter));
    return {
        outfit,
        body: document.body,
        fileHash: createOutfitTagsFileHash(markdown),
        hashes: createOutfitTagHashes(outfit),
    };
}

/** 规范渲染 Outfit Tags V2；正文和显示名称不参与 renderTagFactsHash。 */
export function renderOutfitTagsMarkdown(input: OutfitTags, body?: string): string {
    const outfit = canonicalizeOutfitTags(input);
    return renderStrictTextToImageFrontmatter({
        schema: outfit.schema,
        outfitId: outfit.outfitId,
        ownerCharacterId: outfit.ownerCharacterId,
        names: outfit.names,
        resolutionScope: outfit.resolutionScope,
        fields: outfit.fields,
        fieldProviderSyntaxRefs: outfit.fieldProviderSyntaxRefs,
        providerSyntaxNodes: outfit.providerSyntaxNodes,
        tagResolutions: outfit.tagResolutions,
        policyApprovals: outfit.policyApprovals,
    }, body ?? [
        `# ${[outfit.names.cn, outfit.names.en].filter(Boolean).join(" / ")}`,
        "",
        "运行时只读取并校验 frontmatter；本段仅供作者解释服装来源与适用场景。",
        "",
    ].join("\n"));
}

/** 计算完整 Character Image Tags Markdown 的文件冲突 hash。 */
export function createCharacterImageTagsFileHash(markdown: string): string {
    return createTextToImageMarkdownFileHash(markdown);
}

/** 计算完整 Outfit Tags Markdown 的文件冲突 hash。 */
export function createOutfitTagsFileHash(markdown: string): string {
    return createTextToImageMarkdownFileHash(markdown);
}
