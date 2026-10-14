/**
 * 从样式规则的选择器里找“聚焦时会画焦点环的元素”，给 Lab 的光晕裁切检查（lab-debug.ts）用。只做字符串处理，不碰 DOM。
 */

// 转义的冒号（Tailwind 类名里的 `focus-visible\:ring`）是类名的一部分，不是伪类。
const FOCUS = /(?<!\\):focus-visible|(?<!\\):focus-within|(?<!\\):focus(?![-\w])/u;
const FOCUS_ALL = new RegExp(FOCUS.source, "gu");
const DIRECT = /(?<!\\):focus-visible|(?<!\\):focus(?![-\w])/u;

export interface RingSelector {
    /** 焦点伪类换成恒真的 `:is(*)`：静态地选出聚焦时会画环的元素。 */
    readonly selector: string;
    /**
     * `:focus`、`:focus-visible` 直接写在被选元素自己那一段上：它自己能聚焦才会画环。
     * 否则（`:focus-within`、`:has(... :focus-visible)`）环画在外框上，由里面的元素聚焦触发。
     */
    readonly direct: boolean;
}

/** 按顶层的分隔符切开：圆括号、方括号里的不切，反斜杠转义的字符不算。 */
function splitTopLevel(text: string, isSeparator: (char: string) => boolean): Array<{readonly part: string; readonly end: number}> {
    const parts: Array<{part: string; end: number}> = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index] as string;
        if (char === "\\") {
            index += 1;
        } else if (char === "(" || char === "[") {
            depth += 1;
        } else if (char === ")" || char === "]") {
            depth -= 1;
        } else if (depth === 0 && isSeparator(char)) {
            parts.push({part: text.slice(start, index), end: index});
            start = index + 1;
        }
    }
    parts.push({part: text.slice(start), end: text.length});
    return parts;
}

/** 被选元素自己那一段（最后一个组合符之后），去掉括号里的内容：`:has(...)`、`:is(...)` 里的焦点伪类不算写在它身上。 */
function subjectOutsideParentheses(branch: string): string {
    const compounds = splitTopLevel(branch, (char) => char === " " || char === ">" || char === "+" || char === "~");
    const subject = compounds[compounds.length - 1]?.part ?? "";
    let depth = 0;
    let outside = "";
    for (let index = 0; index < subject.length; index += 1) {
        const char = subject[index] as string;
        if (char === "\\") {
            if (depth === 0) outside += subject.slice(index, index + 2);
            index += 1;
        } else if (char === "(" || char === "[") {
            depth += 1;
        } else if (char === ")" || char === "]") {
            depth -= 1;
        } else if (depth === 0) {
            outside += char;
        }
    }
    return outside;
}

/** 一条规则的选择器（可以是逗号分隔的列表）里含焦点伪类的各个分支；不含的分支（例如同一条规则里的 `:hover`）不算。 */
export function ringSelectors(selectorText: string): RingSelector[] {
    return splitTopLevel(selectorText, (char) => char === ",")
        .map(({part}) => part.trim())
        .filter((branch) => FOCUS.test(branch))
        .map((branch) => ({selector: branch.replace(FOCUS_ALL, ":is(*)"), direct: DIRECT.test(subjectOutsideParentheses(branch))}));
}
