const INSERTION_TYPES = ["前置前", "前置后", "后置前", "后置后", "最后置"] as const;
type InsertionType = typeof INSERTION_TYPES[number];

/**
 * 按 chatu8 的 `触发词=类型|内容` 规则改写 NovelAI 提示词。
 * 支持多触发词（`|` 分隔）、`@if(...)` 条件、替换与五类插入位置；正则模块不移植。
 */
export function applyPromptReplaceRules(prompt: string, rulesText: string): string {
    if (rulesText.trim() === "") {
        return prompt;
    }
    let modified = prompt;
    const insertions: Record<InsertionType, string[]> = {
        "前置前": [],
        "前置后": [],
        "后置前": [],
        "后置后": [],
        "最后置": [],
    };

    for (const line of rulesText.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        const equalIndex = trimmed.indexOf("=");
        if (equalIndex < 0) continue;
        const triggerPart = trimmed.slice(0, equalIndex).trim();
        const rulePart = trimmed.slice(equalIndex + 1);
        const pipeIndex = rulePart.indexOf("|");
        if (pipeIndex < 0) continue;
        const type = rulePart.slice(0, pipeIndex).trim();
        const rawValue = rulePart.slice(pipeIndex + 1).trim();
        const {value, condition} = extractIfCondition(rawValue);
        if (condition !== null && !evaluateIfCondition(condition, prompt)) {
            continue;
        }
        const triggers = triggerPart.split("|").map((word) => word.trim()).filter(Boolean);
        const matched = triggers.find((word) => word !== "" && prompt.toLowerCase().includes(word.toLowerCase()));
        if (matched === undefined) continue;
        if (type === "替换") {
            modified = replaceAllIgnoringCase(modified, matched, value);
        } else if (isInsertionType(type)) {
            insertions[type].push(value);
        }
    }

    const prefix = [...insertions["前置前"], ...insertions["前置后"]].filter((item) => item !== "").join(", ");
    const suffix = [
        ...insertions["后置前"],
        ...insertions["后置后"],
        ...insertions["最后置"],
    ].filter((item) => item !== "").join(", ");
    if (prefix !== "") modified = `${prefix}, ${modified}`;
    if (suffix !== "") modified = `${modified}, ${suffix}`;
    return modified;
}

function isInsertionType(value: string): value is InsertionType {
    return (INSERTION_TYPES as readonly string[]).includes(value);
}

function replaceAllIgnoringCase(text: string, search: string, replacement: string): string {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return text.replace(new RegExp(escaped, "giu"), replacement);
}

function extractIfCondition(rawValue: string): {value: string; condition: string | null} {
    const trimmedRight = rawValue.replace(/\s+$/u, "");
    if (!trimmedRight.endsWith(")")) {
        return {value: rawValue, condition: null};
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
        return {value: rawValue, condition: null};
    }
    const head = trimmedRight.slice(0, openIndex);
    const matched = /@if\s*$/iu.exec(head);
    if (!matched) {
        return {value: rawValue, condition: null};
    }
    const condition = trimmedRight.slice(openIndex + 1, -1).trim();
    if (condition === "") {
        return {value: rawValue, condition: null};
    }
    return {
        value: head.slice(0, head.length - matched[0].length).replace(/\s+$/u, ""),
        condition,
    };
}

/** 求值 `@if(...)` 表达式：支持 `&&`、`||`、`!`、括号和带引号字符串。 */
export function evaluateIfCondition(expression: string, haystack: string): boolean {
    const source = expression;
    const hay = haystack.toLowerCase();
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
            return hay.includes(buffer.toLowerCase());
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
        return hay.includes(word.toLowerCase());
    };

    const result = parseOr();
    skipWhitespace();
    if (position < source.length) {
        throw new Error(`@if 表达式存在未解析片段：${source.slice(position)}`);
    }
    return result;
}
