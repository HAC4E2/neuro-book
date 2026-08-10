/**
 * Removes reasoning/explanation wrappers that some compatible presets place
 * around their actual image output. The wrapper contents are not part of the
 * user-facing image result and must not be mistaken for prompt text.
 */
export function stripLlmReasoningBlocks(text: string): string {
    return text
        .replace(/<(thinking|tag_think|imgthink|disclaimer)\b[^>]*>[\s\S]*?<\/\1>/giu, "")
        .replace(/<\/?(thinking|tag_think|imgthink|disclaimer)\b[^>]*>/giu, "")
        .trim();
}

export function extractLlmImagePrompts(text: string): string[] {
    const cleaned = stripLlmReasoningBlocks(text);
    const candidates: Array<{index: number; prompt: string}> = [];
    for (const match of cleaned.matchAll(/<image\b[^>]*>([\s\S]*?)<\/image>/giu)) {
        candidates.push({
            index: match.index ?? 0,
            prompt: stripImagePromptWrapper(match[1] ?? ""),
        });
    }
    for (const match of cleaned.matchAll(/image###([\s\S]*?)###/giu)) {
        candidates.push({
            index: match.index ?? 0,
            prompt: (match[1] ?? "").trim(),
        });
    }
    return candidates
        .filter((candidate) => candidate.prompt !== "")
        .sort((left, right) => left.index - right.index)
        .map((candidate) => candidate.prompt);
}

export function extractLastLlmImagePrompt(text: string): string {
    const prompt = extractLlmImagePrompts(text).at(-1);
    if (!prompt) {
        throw new Error("LLM 输出中未找到合法 image###...### 或 <image>...</image> 图片块，内容为空或标记缺失");
    }
    return prompt!;
}

function stripImagePromptWrapper(value: string): string {
    return value
        .replace(/<prompts?\b[^>]*>/giu, "")
        .replace(/<\/prompts?>/giu, "")
        .trim();
}
