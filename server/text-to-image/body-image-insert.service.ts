import {randomUUID} from "node:crypto";
import {
    renderTextToImagePromptMarkdown,
    type TextToImagePromptPayload,
} from "nbook/shared/text-to-image-markdown";
import type {BodyImageBlock} from "nbook/server/text-to-image/body-image-llm";
import type {BodyImageDiagnostic} from "nbook/server/text-to-image/body-image-diagnostics";
import {IllustrationDirector} from "nbook/server/text-to-image/illustration-director";

/**
 * 把 L1 `<image>` 块转成 L2 占位符，插入到匹配 `<regex>` 的正文行之后。
 * 锚点命中唯一行时插入到该行之后；零命中降级到正文末尾，多命中使用第一行。
 * 多个块可以共享同一锚点，并按 LLM 回复顺序插入，原始 XML 标签不会进入正文。
 */
export function insertBodyImagePlaceholders(input: {
    chapterContent: string;
    blocks: BodyImageBlock[];
}): {
    content: string;
    placeholders: TextToImagePromptPayload[];
    diagnostics: BodyImageDiagnostic[];
} {
    new IllustrationDirector().assertCanonical(input.blocks);
    const lines = input.chapterContent.split("\n");
    const insertions = new Map<number, TextToImagePromptPayload[]>();
    const placeholders: TextToImagePromptPayload[] = [];
    const diagnostics: BodyImageDiagnostic[] = [];
    const resolvedAnchorLines = new Map<string, {lineIndex: number; code: "anchor_appended" | "anchor_first_match" | null}>();
    const temporaryCharacters = [...new Map(
        input.blocks.flatMap((block) => block.temporaryCharacters ?? [])
            .map((character) => [character.characterId, character] as const),
    ).values()];

    for (const block of input.blocks) {
        const anchor = block.regex.trim();
        let target = resolvedAnchorLines.get(anchor);
        if (target === undefined) {
            const matchingLines = anchor === ""
                ? []
                : lines.reduce<number[]>((matches, line, index) => {
                    if (line.includes(anchor)) matches.push(index);
                    return matches;
                }, []);
            const lineIndex = matchingLines.length === 0
                ? Math.max(0, lines.length - 1)
                : matchingLines[0]!;
            const code = matchingLines.length === 0
                ? "anchor_appended"
                : matchingLines.length > 1
                    ? "anchor_first_match"
                    : null;
            target = {lineIndex, code};
            resolvedAnchorLines.set(anchor, target);
        }
        if (target.code !== null) {
            diagnostics.push({
                blockIndex: block.sourceIndex ?? placeholders.length + 1,
                code: target.code,
                action: "inserted",
                message: target.code === "anchor_appended"
                    ? `第 ${block.sourceIndex ?? placeholders.length + 1} 个图片块锚点未命中，已插入正文末尾`
                    : `第 ${block.sourceIndex ?? placeholders.length + 1} 个图片块锚点命中多行，已使用第一行`,
            });
        }
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
        const existing = insertions.get(target.lineIndex) ?? [];
        existing.push(payload);
        insertions.set(target.lineIndex, existing);
        placeholders.push(payload);
    }

    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const list = insertions.get(index);
        if (!list || list.length === 0) {
            continue;
        }
        lines.splice(index + 1, 0, ...list.map(renderTextToImagePromptMarkdown));
    }

    return {content: lines.join("\n"), placeholders, diagnostics};
}
