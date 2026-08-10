type ParsedNovelAiTag = {
    raw: string;
    key: string;
    weighted: boolean;
};

/**
 * 清理最终发给 NovelAI 的逗号 tag 串。
 * 同一基础 tag 只保留一次；存在带数值权重的版本时优先保留权重版本。
 */
export function dedupeNovelAiPrompt(prompt: string): string {
    const tags = prompt
        .split(",")
        .map((tag) => parseTag(tag))
        .filter((tag): tag is ParsedNovelAiTag => tag !== null);
    const result: ParsedNovelAiTag[] = [];
    const indexByKey = new Map<string, number>();

    for (const tag of tags) {
        const existingIndex = indexByKey.get(tag.key);
        if (existingIndex === undefined) {
            indexByKey.set(tag.key, result.length);
            result.push(tag);
            continue;
        }
        const existing = result[existingIndex];
        if (existing && tag.weighted) {
            result[existingIndex] = tag;
        }
    }

    return result.map((tag) => tag.raw).join(", ");
}

function parseTag(value: string): ParsedNovelAiTag | null {
    const raw = value.trim().replace(/^,+|,+$/gu, "");
    if (raw === "") return null;
    const suffixWeightedMatch = /^(.*?)(?::\s*-?\d+(?:\.\d+)?)$/u.exec(raw);
    const prefixWeightedMatch = /^\s*-?\d+(?:\.\d+)?::(.*)::\s*$/u.exec(raw);
    const weightedMatch = suffixWeightedMatch ?? prefixWeightedMatch;
    const unwrapped = (suffixWeightedMatch?.[1] ?? prefixWeightedMatch?.[1] ?? raw)
        .trim()
        .replace(/^(?:\{+|\[+)|(?:\}+|\]+)$/gu, "")
        .trim();
    if (unwrapped === "") return null;
    return {
        raw,
        key: unwrapped.toLocaleLowerCase(),
        weighted: weightedMatch !== null,
    };
}
