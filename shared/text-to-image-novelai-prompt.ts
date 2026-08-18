type ParsedNovelAiTag = {
    raw: string;
    key: string;
    weighted: boolean;
    priority: number;
};

export type FinalNovelAiCharacterPrompt = {
    positive: string;
    negative: string;
    centerX?: number;
    centerY?: number;
};

export type FinalNovelAiPromptBundle = {
    version: 1;
    modelFamily: "nai4";
    basePositive: string;
    baseNegative: string;
    characters: FinalNovelAiCharacterPrompt[];
    actualInput: string;
    actualNegativeInput: string;
    appliedRuleLines: number[];
};

/**
 * 清理最终发给 NovelAI 的逗号 tag 串。
 * 同一基础 tag 只保留一次；存在带数值权重的版本时优先保留加权版本，
 * 多个加权版本按输入顺序取最后一个，保证同输入结果确定。
 */
export function dedupeNovelAiPrompt(prompt: string): string {
    const tags = splitNovelAiTags(prompt)
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
        if (existing && (!existing.weighted || tag.weighted)) {
            result[existingIndex] = tag;
        }
    }

    return result.map((tag) => tag.raw).join(", ");
}

/**
 * 按括号深度切分 tag：`{}`/`[]`/`()` 内的逗号不是分隔符，
 * 避免把 NovelAI 权重或不可拆结构错误切成两个 tag。
 */
export function splitNovelAiTags(prompt: string): string[] {
    const result: string[] = [];
    let start = 0;
    let depth = 0;
    for (let index = 0; index < prompt.length; index += 1) {
        const character = prompt[index]!;
        if (character === "{" || character === "[" || character === "(") {
            depth += 1;
        } else if (character === "}" || character === "]" || character === ")") {
            depth = Math.max(0, depth - 1);
        } else if (character === "," && depth === 0) {
            result.push(prompt.slice(start, index));
            start = index + 1;
        }
    }
    result.push(prompt.slice(start));
    return result;
}

function parseTag(value: string): ParsedNovelAiTag | null {
    const raw = value.trim().replace(/^,+|,+$/gu, "");
    if (raw === "") return null;
    const suffixWeightedMatch = /^(.*?)(?::\s*-?\d+(?:\.\d+)?)$/u.exec(raw);
    const prefixWeightedMatch = /^\s*-?\d+(?:\.\d+)?::(.*)::\s*$/u.exec(raw);
    const weightedMatch = suffixWeightedMatch ?? prefixWeightedMatch;
    const body = suffixWeightedMatch?.[1] ?? prefixWeightedMatch?.[1] ?? raw;
    const unwrapped = body
        .trim()
        .replace(/^(?:\{+|\[+)|(?:\}+|\]+)$/gu, "")
        .trim();
    if (unwrapped === "") return null;
    const priority = weightedMatch ? parseNovelAiWeight(weightedMatch[0] ?? "") : 0;
    return {
        raw,
        key: normalizeNovelAiTagKey(unwrapped),
        weighted: weightedMatch !== null,
        priority,
    };
}

function parseNovelAiWeight(raw: string): number {
    const match = /-?\d+(?:\.\d+)?/u.exec(raw);
    if (!match) return 0;
    return Number.parseFloat(match[0]);
}

function normalizeNovelAiTagKey(value: string): string {
    return value.normalize("NFKC").toLocaleLowerCase();
}
