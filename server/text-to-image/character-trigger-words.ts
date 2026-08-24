import type {CharacterVisualField} from "nbook/server/text-to-image/character-visual.codec";

/**
 * 角色触发词领域模块：唯一的运行时触发词合同实现。
 *
 * 合同要点：
 * - 唯一运行时分隔符是半角竖线 `|`；保存规范格式为单个空格包围的 ` | `；
 * - 英文逗号 `,` 和中文逗号 `，` 不是分隔符，出现在新输入中直接校验失败；
 * - 不允许连续空项；每项首尾空白会被去除，按 Unicode NFKC 规范化后去重，
 *   显示保留第一次输入的文本形式；
 * - 显式触发词非空时只使用显式列表；为空时由调用方（正文扫描）临时回退中英文名，
 *   绝不把回退名称写回 JSON。
 */
export type ParsedCharacterTriggers = {
    values: string[];
    canonical: string;
};

/** Project 视觉库已完成 pipe-v1 一次性迁移的格式标记值。 */
export const TRIGGER_WORD_FORMAT_MARKER = "pipe-v1";

export class TriggerWordFormatError extends Error {
    readonly code = "TEXT_TO_IMAGE_TRIGGER_WORD_FORMAT";

    constructor(message: string) {
        super(message);
        this.name = "TriggerWordFormatError";
    }
}

/** 规范化单个触发词用于匹配与去重：NFKC + 大小写折叠。中文不受折叠影响，保持子串语义。 */
export function normalizeTriggerToken(value: string): string {
    return value.normalize("NFKC").toLocaleLowerCase();
}

/** 输入是否包含已废弃的逗号分隔符。 */
export function containsForbiddenTriggerSeparator(raw: string): boolean {
    return raw.includes(",") || raw.includes("，");
}

/**
 * 严格解析 `|` 分隔的触发词。只允许 `.split("|")`，不存在任何逗号兼容分支。
 * 包含逗号、连续空项或首尾空项时抛出 TriggerWordFormatError。
 */
export function parsePipeCharacterTriggers(raw: string): ParsedCharacterTriggers {
    if (containsForbiddenTriggerSeparator(raw)) {
        throw new TriggerWordFormatError("触发词只能使用 | 分隔");
    }
    const parts = raw.split("|");
    if (parts.length > 1 && parts.some((part) => part.trim() === "")) {
        throw new TriggerWordFormatError(parts.some((part) => part === "")
            ? "触发词不能包含连续空项"
            : "触发词不能包含空项");
    }
    const values: string[] = [];
    const seen = new Set<string>();
    for (const part of parts) {
        const value = part.trim();
        if (value === "") continue;
        const key = normalizeTriggerToken(value);
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(value);
    }
    return {values, canonical: values.join(" | ")};
}

/** 规范化触发词字符串到保存格式；空字符串保持为空，格式错误时抛出 TriggerWordFormatError。 */
export function canonicalizeTriggerWords(raw: string): string {
    if (raw.trim() === "") return "";
    return parsePipeCharacterTriggers(raw).canonical;
}

/**
 * 角色名称字段的兼容别名解析。
 *
 * `enName` 历史上允许用户用 `|` 记录多个英文名，但触发词解析器只
 * 负责 `triggerWords`。名称字段不能复用严格触发词解析（名称可以包含
 * 逗号），这里只按 `|` 拆分、去空白并按规范化值去重。
 */
export function splitCharacterNameAliases(value: string): string[] {
    const values: string[] = [];
    const seen = new Set<string>();
    for (const part of value.split("|")) {
        const item = part.trim();
        if (item === "") continue;
        const key = normalizeTriggerToken(item);
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(item);
    }
    return values;
}

function buildCharacterNameTerms(character: CharacterVisualField): string[] {
    return [character.enName ?? "", character.cnName ?? ""]
        .flatMap((value) => splitCharacterNameAliases(value));
}

/**
 * 角色的有效扫描触发词：显式列表非空时只使用显式列表；
 * 为空时临时回退到非空的中文名和英文名。回退结果绝不写回 JSON。
 */
export function buildEffectiveCharacterTriggers(character: CharacterVisualField): string[] {
    const explicit = parsePipeCharacterTriggers(character.triggerWords ?? "").values;
    if (explicit.length > 0) return explicit;
    return buildCharacterNameTerms(character);
}

/**
 * 显式引用查找词：触发词 + 中英文名，供 `${角色:名}` / 旧式角色调用按名称定位视觉资料。
 * 与扫描回退不同，显式引用是用户点名要某个角色，名称永远参与匹配。
 */
export function buildCharacterReferenceTerms(character: CharacterVisualField): string[] {
    const values = parsePipeCharacterTriggers(character.triggerWords ?? "").values;
    const seen = new Set(values.map(normalizeTriggerToken));
    const result = [...values];
    for (const value of buildCharacterNameTerms(character)) {
        const key = normalizeTriggerToken(value);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}
