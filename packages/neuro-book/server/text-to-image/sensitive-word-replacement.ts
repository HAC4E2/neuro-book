export type ReplacementRule = {
    find: string;
    replace: string;
};

/**
 * 解析 `find=replace` 规则文本；`A|B=replace` 会展开为多条规则。
 */
export function parseReplacementRules(rulesText: string): ReplacementRule[] {
    const rules: ReplacementRule[] = [];
    for (const line of rulesText.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex <= 0) continue;
        const findPart = trimmed.slice(0, separatorIndex).trim();
        const replace = trimmed.slice(separatorIndex + 1);
        for (const find of findPart.split("|")) {
            const normalized = find.trim();
            if (normalized) {
                rules.push({find: normalized, replace});
            }
        }
    }
    return rules;
}

/** 对文本应用指定规则文本；规则文本为空时原样返回。 */
export function applyReplacementProfile(input: {
    text: string;
    rulesText: string;
    kind: "text" | "ai";
}): string {
    if (!input.rulesText.trim()) return input.text;
    let result = input.text;
    for (const rule of parseReplacementRules(input.rulesText)) {
        const escaped = escapeRegex(rule.find);
        result = result.replace(new RegExp(escaped, "gu"), rule.replace);
    }
    return result;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
