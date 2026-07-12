export type TextToImagePromptRuleTarget = "positive" | "negative";
export type TextToImagePromptRuleMatchMode = "plain" | "regex";
export type TextToImagePromptRuleMode = "replace" | "append" | "prepend" | "delete";

export type TextToImagePromptReplacementRule = {
    id: string;
    name: string;
    enabled: boolean;
    target: TextToImagePromptRuleTarget;
    matchMode: TextToImagePromptRuleMatchMode;
    mode: TextToImagePromptRuleMode;
    trigger: string;
    replacement: string;
};

/** 合并逗号分隔 tag，但不改写 NovelAI 的权重、括号或方括号文本。 */
export function mergeTextToImageTags(...parts: Array<string | null | undefined>): string {
    return parts.flatMap((part) => splitTextToImageTags(part ?? ""))
        .map((tag) => tag.trim())
        .filter(Boolean)
        .join(", ");
}

/** 按大小写无关的精确 tag 稳定去重。 */
export function dedupeTextToImageTags(value: string): string {
    const seen = new Set<string>();
    return splitTextToImageTags(value).map((tag) => tag.trim()).filter(Boolean).filter((tag) => {
        const key = tag.toLocaleLowerCase();
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    }).join(", ");
}

/** 按顺序应用启用的替换规则一次。 */
export function applyTextToImagePromptRules(input: {
    prompt: string;
    negativePrompt: string;
    promptRules: TextToImagePromptReplacementRule[];
}): {prompt: string; negativePrompt: string; appliedRuleIds: string[]} {
    let prompt = input.prompt;
    let negativePrompt = input.negativePrompt;
    const appliedRuleIds: string[] = [];
    for (const rule of input.promptRules) {
        if (!rule.enabled) {
            continue;
        }
        const current = rule.target === "negative" ? negativePrompt : prompt;
        const next = applyRule(current, rule);
        if (next === current && rule.mode !== "append" && rule.mode !== "prepend") {
            continue;
        }
        if (rule.target === "negative") {
            negativePrompt = next;
        } else {
            prompt = next;
        }
        appliedRuleIds.push(rule.id);
    }
    return {prompt, negativePrompt, appliedRuleIds};
}

function applyRule(content: string, rule: TextToImagePromptReplacementRule): string {
    const replacement = rule.replacement.trim();
    if (rule.mode === "append") {
        return mergeTextToImageTags(content, replacement);
    }
    if (rule.mode === "prepend") {
        return mergeTextToImageTags(replacement, content);
    }
    const trigger = rule.trigger.trim();
    if (!trigger) {
        return content;
    }
    const pattern = rule.matchMode === "regex" ? safeRegExp(trigger) : null;
    if (rule.matchMode === "regex" && !pattern) {
        return content;
    }
    if (rule.mode === "delete") {
        return pattern ? content.replace(pattern, "") : content.split(trigger).join("");
    }
    return pattern ? content.replace(pattern, replacement) : content.split(trigger).join(replacement);
}

function splitTextToImageTags(value: string): string[] {
    return value.split(/[,，]/u);
}

function safeRegExp(source: string): RegExp | null {
    try {
        return new RegExp(source, "giu");
    } catch {
        return null;
    }
}
