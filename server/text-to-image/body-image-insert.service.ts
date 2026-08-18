import {randomUUID} from "node:crypto";
import {
    renderTextToImagePromptMarkdown,
    type TextToImagePromptPayload,
} from "nbook/shared/text-to-image-markdown";
import type {BodyImageBlock} from "nbook/server/text-to-image/body-image-llm";
import {IllustrationDirector} from "nbook/server/text-to-image/illustration-director";

/**
 * 把 L1 `<image>` 块转成 L2 占位符，插入到匹配 `<regex>` 的正文行之后。
 * 锚点必须精确命中一行；零命中、多命中或同锚点重复块都会阻止写入，原始 XML 标签不会进入正文。
 */
export class BodyImageAnchorError extends Error {
    readonly code: "anchor_missing" | "anchor_ambiguous" | "anchor_conflict";

    constructor(code: BodyImageAnchorError["code"], anchor: string) {
        super(code === "anchor_missing"
            ? `图片锚点未命中正文：${anchor}`
            : code === "anchor_ambiguous"
                ? `图片锚点命中多行，无法安全插入：${anchor}`
                : `LLM 返回了重复图片锚点：${anchor}`);
        this.name = "BodyImageAnchorError";
        this.code = code;
    }
}

export function insertBodyImagePlaceholders(input: {
    chapterContent: string;
    blocks: BodyImageBlock[];
}): {content: string; placeholders: TextToImagePromptPayload[]} {
    new IllustrationDirector().assertCanonical(input.blocks);
    const lines = input.chapterContent.split("\n");
    const insertions = new Map<number, TextToImagePromptPayload[]>();
    const placeholders: TextToImagePromptPayload[] = [];
    const seenAnchors = new Set<string>();
    const temporaryCharacters = [...new Map(
        input.blocks.flatMap((block) => block.temporaryCharacters ?? [])
            .map((character) => [character.characterId, character] as const),
    ).values()];

    for (const block of input.blocks) {
        const anchor = block.regex.trim();
        if (anchor === "") {
            throw new BodyImageAnchorError("anchor_missing", "（空锚点）");
        }
        if (seenAnchors.has(anchor)) throw new BodyImageAnchorError("anchor_conflict", anchor);
        seenAnchors.add(anchor);
        const matchingLines = lines.reduce<number[]>((matches, line, index) => {
            if (line.includes(anchor)) matches.push(index);
            return matches;
        }, []);
        if (matchingLines.length === 0) throw new BodyImageAnchorError("anchor_missing", anchor);
        if (matchingLines.length > 1) throw new BodyImageAnchorError("anchor_ambiguous", anchor);
        const lineIndex = matchingLines[0]!;
        const payload: TextToImagePromptPayload = {
            id: `tti-${randomUUID()}`,
            schema: "nbook.text-to-image-prompt/v1",
            prompt: block.prompt ?? block.prompts,
            negativePrompt: "",
            anchor,
            title: block.title,
            size: block.size,
            tagThink: block.tagThink,
            ...(block.characterPrompts && block.characterPrompts.length > 0
                ? {characterPrompts: block.characterPrompts}
                : {}),
            ...(temporaryCharacters.length > 0 ? {temporaryCharacters} : {}),
        };
        const existing = insertions.get(lineIndex) ?? [];
        existing.push(payload);
        insertions.set(lineIndex, existing);
        placeholders.push(payload);
    }

    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const list = insertions.get(index);
        if (!list || list.length === 0) {
            continue;
        }
        lines.splice(index + 1, 0, ...list.map(renderTextToImagePromptMarkdown));
    }

    return {content: lines.join("\n"), placeholders};
}
