const INSERTION_TYPES = ["前置前", "前置后", "后置前", "后置后", "最后置"] as const;
const REPLACE_TYPES = ["替换", "替换分角色"] as const;
const ACTION_TYPES = [...INSERTION_TYPES, ...REPLACE_TYPES] as const;

type InsertionType = typeof INSERTION_TYPES[number];
type ReplaceType = typeof REPLACE_TYPES[number];
type PromptReplacementAction = typeof ACTION_TYPES[number];

export type PromptReplacementRule = {
    lineNumber: number;
    triggers: string[];
    action: PromptReplacementAction;
    value: string;
    condition: string | null;
};

export type PromptReplacementIssue = {
    lineNumber: number;
    message: string;
};

export type ParsedPromptReplacementRules = {
    rules: PromptReplacementRule[];
    errors: PromptReplacementIssue[];
};

export type PromptReplacementSegments = {
    beforeFront: string[];
    afterFront: string[];
    base: string;
    beforeBack: string[];
    afterBack: string[];
    last: string[];
};

export type PromptReplacementResult = {
    basePositive: string;
    baseNegative: string;
    characterPrompts: Array<{positive: string; negative: string; centerX?: number; centerY?: number}>;
    segments: PromptReplacementSegments;
    appliedRuleLines: number[];
};

export type ApplyPromptReplacementInput = {
    prompt: string;
    rulesText: string;
    characterPrompts?: Array<{prompt: string; negativePrompt: string; centerX?: number; centerY?: number}>;
};

/**
 * 将 chatu8 的 `触发词=动作|插入词` 文本解析为带行号的规则 AST。
 * 空行允许；非空行缺少 `=`、缺少动作分隔符、触发词为空或动作未知都返回行号错误。
 */
export function parsePromptReplacementRules(rulesText: string): ParsedPromptReplacementRules {
    const rules: PromptReplacementRule[] = [];
    const errors: PromptReplacementIssue[] = [];
    const lines = rulesText.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        const trimmed = lines[index]!.trim();
        if (trimmed === "") continue;
        const equalIndex = trimmed.indexOf("=");
        if (equalIndex < 0) {
            errors.push({lineNumber, message: `第 ${lineNumber} 行缺少 =`});
            continue;
        }
        if (equalIndex === 0) {
            errors.push({lineNumber, message: `第 ${lineNumber} 行触发词为空`});
            continue;
        }
        const triggerPart = trimmed.slice(0, equalIndex).trim();
        const rulePart = trimmed.slice(equalIndex + 1);
        const pipeIndex = rulePart.indexOf("|");
        if (pipeIndex < 0) {
            errors.push({lineNumber, message: `第 ${lineNumber} 行缺少动作分隔符 |`});
            continue;
        }
        const action = rulePart.slice(0, pipeIndex).trim() as PromptReplacementAction;
        if (!isPromptReplacementAction(action)) {
            errors.push({lineNumber, message: `第 ${lineNumber} 行动作未知：${action}`});
            continue;
        }
        const triggers = triggerPart
            .split("|")
            .map((word) => word.trim())
            .filter((word) => word !== "");
        if (triggers.length === 0) {
            errors.push({lineNumber, message: `第 ${lineNumber} 行触发词为空`});
            continue;
        }
        const rawValue = rulePart.slice(pipeIndex + 1).trim();
        const extracted = extractIfCondition(rawValue);
        if (extracted.error !== null) {
            errors.push({lineNumber, message: `第 ${lineNumber} 行 ${extracted.error}`});
            continue;
        }
        rules.push({
            lineNumber,
            triggers,
            action,
            value: extracted.value,
            condition: extracted.condition,
        });
    }
    return {rules, errors};
}

/**
 * 结构化应用替换规则。五种插入动作进入对应命名段，`替换` 只改正文段，
 * `替换分角色` 逐角色槽执行；没有角色槽时是可预览的 no-op。
 */
export function applyPromptReplacementToSegments(input: ApplyPromptReplacementInput): PromptReplacementResult {
    const parsed = parsePromptReplacementRules(input.rulesText);
    const originalBase = input.prompt;
    const originalCharacters = (input.characterPrompts ?? []).map((item) => ({
        positive: item.prompt,
        negative: item.negativePrompt,
        centerX: item.centerX,
        centerY: item.centerY,
    }));
    const segments: PromptReplacementSegments = {
        beforeFront: [],
        afterFront: [],
        base: originalBase,
        beforeBack: [],
        afterBack: [],
        last: [],
    };
    const characters = originalCharacters.map((item) => ({...item}));
    const appliedRuleLines: number[] = [];

    for (const rule of parsed.rules) {
        if (rule.condition !== null && !evaluateIfCondition(rule.condition, originalBase)) {
            continue;
        }
        const matched = rule.triggers.find((word) => containsNormalized(originalBase, word));
        if (matched === undefined) continue;
        if (rule.action === "替换") {
            segments.base = replaceAllIgnoringCase(segments.base, matched, rule.value);
            appliedRuleLines.push(rule.lineNumber);
        } else if (rule.action === "替换分角色") {
            for (const character of characters) {
                if (containsNormalized(character.positive, matched)) {
                    character.positive = replaceAllIgnoringCase(character.positive, matched, rule.value);
                }
            }
            appliedRuleLines.push(rule.lineNumber);
        } else {
            segments[insertionSegmentKey(rule.action)].push(rule.value);
            appliedRuleLines.push(rule.lineNumber);
        }
    }
    return {
        basePositive: segments.base,
        baseNegative: "",
        characterPrompts: characters.map((item) => ({
            positive: item.positive,
            negative: item.negative,
            ...(item.centerX === undefined ? {} : {centerX: item.centerX}),
            ...(item.centerY === undefined ? {} : {centerY: item.centerY}),
        })),
        segments,
        appliedRuleLines,
    };
}

/** 旧调用兼容：只处理单段正文，返回替换与插入后的完整串。 */
export function applyPromptReplaceRules(prompt: string, rulesText: string): string {
    const result = applyPromptReplacementToSegments({prompt, rulesText});
    const prefix = joinParts(result.segments.beforeFront);
    const afterFront = joinParts(result.segments.afterFront);
    const beforeBack = joinParts(result.segments.beforeBack);
    const afterBack = joinParts(result.segments.afterBack);
    const last = joinParts(result.segments.last);
    return joinPromptSegments(prefix, afterFront, result.basePositive, beforeBack, afterBack, last);
}

export function validatePromptReplacementRules(rulesText: string): PromptReplacementIssue[] {
    return parsePromptReplacementRules(rulesText).errors;
}

function isPromptReplacementAction(value: string): value is PromptReplacementAction {
    return (ACTION_TYPES as readonly string[]).includes(value);
}

function insertionSegmentKey(action: InsertionType): keyof Omit<PromptReplacementSegments, "base"> {
    if (action === "前置前") return "beforeFront";
    if (action === "前置后") return "afterFront";
    if (action === "后置前") return "beforeBack";
    if (action === "后置后") return "afterBack";
    return "last";
}

function containsNormalized(haystack: string, needle: string): boolean {
    return normalizePromptText(haystack).includes(normalizePromptText(needle));
}

function normalizePromptText(value: string): string {
    return value.normalize("NFKC").toLocaleLowerCase();
}

function replaceAllIgnoringCase(text: string, search: string, replacement: string): string {
    if (search === "") return text;
    const units = Array.from(text);
    const searchUnits = Array.from(search);
    const result: string[] = [];
    for (let index = 0; index < units.length;) {
        const candidate = units.slice(index, index + searchUnits.length).join("");
        if (normalizePromptText(candidate) === normalizePromptText(search)) {
            result.push(replacement);
            index += searchUnits.length;
            continue;
        }
        result.push(units[index]!);
        index += 1;
    }
    return cleanPromptText(result.join(""));
}

function cleanPromptText(value: string): string {
    return value
        .replace(/\s*,\s*,+/gu, ", ")
        .replace(/^\s*,\s*/u, "")
        .replace(/\s*,\s*$/u, "")
        .trim();
}

function joinParts(parts: string[]): string {
    return parts.filter((part) => part.trim() !== "").join(", ");
}

function joinPromptSegments(...parts: string[]): string {
    return parts
        .map((part) => part.trim().replace(/^,+|,+$/gu, ""))
        .filter((part) => part !== "")
        .join(", ");
}

type ExtractedIfCondition = {value: string; condition: string | null; error: string | null};

function extractIfCondition(rawValue: string): ExtractedIfCondition {
    const trimmedRight = rawValue.replace(/\s+$/u, "");
    if (!trimmedRight.endsWith(")")) {
        return {value: rawValue, condition: null, error: null};
    }
    let depth = 0;
    let openIndex = -1;
    for (let index = trimmedRight.length - 1; index >= 0; index -= 1) {
        const character = trimmedRight[index];
        if (character === ")") depth += 1;
        else if (character === "(") {
            depth -= 1;
            if (depth === 0) {
                openIndex = index;
                break;
            }
        }
    }
    if (openIndex <= 0) {
        return {value: rawValue, condition: null, error: null};
    }
    const head = trimmedRight.slice(0, openIndex);
    const matched = /@if\s*$/iu.exec(head);
    if (!matched) {
        return {value: rawValue, condition: null, error: null};
    }
    const condition = trimmedRight.slice(openIndex + 1, -1).trim();
    if (condition === "") {
        return {value: rawValue, condition: null, error: "@if 条件为空"};
    }
    try {
        evaluateIfCondition(condition, "probe");
    } catch (error) {
        return {
            value: rawValue,
            condition: null,
            error: error instanceof Error ? error.message : "@if 条件无法解析",
        };
    }
    return {
        value: head.slice(0, head.length - matched[0].length).replace(/\s+$/u, ""),
        condition,
        error: null,
    };
}

/** 求值 `@if(...)` 表达式：支持 `&&`、`||`、`!`、括号和带引号字符串。 */
export function evaluateIfCondition(expression: string, haystack: string): boolean {
    const source = expression;
    const hay = haystack.normalize("NFKC").toLocaleLowerCase();
    let position = 0;

    const skipWhitespace = (): void => {
        while (position < source.length && /\s/u.test(source[position] ?? "")) position += 1;
    };
    const parseOr = (): boolean => {
        let left = parseAnd();
        skipWhitespace();
        while (source.startsWith("||", position)) {
            position += 2;
            left = left || parseAnd();
            skipWhitespace();
        }
        return left;
    };
    const parseAnd = (): boolean => {
        let left = parseUnary();
        skipWhitespace();
        while (source.startsWith("&&", position)) {
            position += 2;
            left = left && parseUnary();
            skipWhitespace();
        }
        return left;
    };
    const parseUnary = (): boolean => {
        skipWhitespace();
        if (source[position] === "!") {
            position += 1;
            return !parseUnary();
        }
        return parsePrimary();
    };
    const parsePrimary = (): boolean => {
        skipWhitespace();
        if (source[position] === "(") {
            position += 1;
            const value = parseOr();
            skipWhitespace();
            if (source[position] !== ")") throw new Error("@if 表达式缺少右括号");
            position += 1;
            return value;
        }
        if (source[position] === "\"") {
            position += 1;
            let buffer = "";
            while (position < source.length && source[position] !== "\"") {
                buffer += source[position] ?? "";
                position += 1;
            }
            if (source[position] !== "\"") throw new Error("@if 表达式缺少右引号");
            position += 1;
            return hay.includes(buffer.normalize("NFKC").toLocaleLowerCase());
        }
        const start = position;
        while (position < source.length) {
            const character = source[position] ?? "";
            if (/[\s()!]/u.test(character) || source.startsWith("&&", position) || source.startsWith("||", position)) {
                break;
            }
            position += 1;
        }
        const word = source.slice(start, position).trim();
        if (word === "") throw new Error("@if 表达式存在空触发词");
        return hay.includes(word.normalize("NFKC").toLocaleLowerCase());
    };

    const result = parseOr();
    skipWhitespace();
    if (position < source.length) {
        throw new Error(`@if 表达式存在未解析片段：${source.slice(position)}`);
    }
    return result;
}
