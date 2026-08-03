import {randomUUID} from "node:crypto";
import {
    renderTextToImagePromptMarkdown,
    type TextToImagePromptPayload,
} from "nbook/shared/text-to-image-markdown";
import type {BodyImageBlock} from "nbook/server/text-to-image/body-image-llm";

/**
 * 把 L1 `<image>` 块转成 L2 占位符，插入到匹配 `<regex>` 的正文行之后。
 * 匹配不到的行跳过；原始 XML 标签不会进入正文。
 */
export function insertBodyImagePlaceholders(input: {
    chapterContent: string;
    blocks: BodyImageBlock[];
}): {content: string; placeholders: TextToImagePromptPayload[]} {
    const lines = input.chapterContent.split("\n");
    const insertions = new Map<number, TextToImagePromptPayload[]>();
    const placeholders: TextToImagePromptPayload[] = [];

    for (const block of input.blocks) {
        const anchor = block.regex.trim();
        if (anchor === "") {
            continue;
        }
        const lineIndex = lines.findIndex((line) => line.includes(anchor));
        if (lineIndex === -1) {
            continue;
        }
        const payload: TextToImagePromptPayload = {
            id: `tti-${randomUUID()}`,
            schema: "nbook.text-to-image-prompt/v1",
            prompt: block.prompts,
            negativePrompt: "",
            anchor,
            title: block.title,
            size: block.size,
            tagThink: block.tagThink,
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
