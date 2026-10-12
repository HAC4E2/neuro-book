/**
 * 通用列表的控件选法（docs/specs/settings/settings-window.md 输出 9）：按配置项的 schema 与 `choices` 选控件，给出控件
 * 要的选项、范围与长度。结果是纯数据，`SettingsControl.vue` 按它画，Lab 也能直接把它当场景输入。
 */

import type {DisplayLocale} from "nbook/shared/localized-text";
import type {SettingDeclaration, SettingLiteral} from "nbook/shared/settings";
import {settingChoices} from "nbook/ui/settings/setting-text";

/** 选项不超过这么多用分段控件，多于它用下拉。 */
export const SEGMENTED_LIMIT = 3;

export interface SettingControlChoice {
    readonly value: SettingLiteral;
    readonly label: string;
}

export type SettingControl =
    | {readonly kind: "switch"}
    | {readonly kind: "segmented"; readonly choices: ReadonlyArray<SettingControlChoice>}
    | {readonly kind: "select"; readonly choices: ReadonlyArray<SettingControlChoice>}
    | {readonly kind: "number"; readonly integer: boolean; readonly min?: number; readonly max?: number; readonly step?: number}
    | {readonly kind: "text"; readonly minLength?: number; readonly maxLength?: number}
    /** 画不了的类型（数组、对象、单个常量与其余联合）：只读显示，宽排法。 */
    | {readonly kind: "readonly"};

interface SchemaFields {
    readonly type?: unknown;
    readonly const?: unknown;
    readonly minimum?: unknown;
    readonly maximum?: unknown;
    readonly multipleOf?: unknown;
    readonly minLength?: unknown;
    readonly maxLength?: unknown;
}

const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

export function settingControl(declaration: SettingDeclaration, locale: DisplayLocale): SettingControl {
    const choices = settingChoices(declaration, locale);
    if (choices !== null) return {kind: choices.length <= SEGMENTED_LIMIT ? "segmented" : "select", choices};
    const schema = declaration.schema as SchemaFields;
    if (Object.hasOwn(schema, "const")) return {kind: "readonly"};
    if (schema.type === "boolean") return {kind: "switch"};
    if (schema.type === "number" || schema.type === "integer") {
        return {
            kind: "number",
            integer: schema.type === "integer",
            ...optional("min", finite(schema.minimum)),
            ...optional("max", finite(schema.maximum)),
            ...optional("step", finite(schema.multipleOf)),
        };
    }
    if (schema.type === "string") return {kind: "text", ...optional("minLength", finite(schema.minLength)), ...optional("maxLength", finite(schema.maxLength))};
    return {kind: "readonly"};
}

/** 估字宽：汉字等全角字符一个字宽，大写字母与数字约七成，空格三成，其余约六成。 */
function emWidth(label: string): number {
    let width = 0;
    for (const char of label) {
        const code = char.codePointAt(0) ?? 0;
        width += code >= 0x2e80 ? 1 : /[A-Z0-9]/u.test(char) ? 0.68 : char === " " ? 0.3 : 0.58;
    }
    return width;
}

/**
 * 分段控件的 CSS 宽度：最长的选项名按 `--text-xs` 估出的宽度，加段内左右内边距（各 12px）与一点余量，乘以段数，再加外槽的
 * 内边距与描边。nb-ui 的分段控件宽度随内容时各段等分、长选项被截断（w00017 t81），在那之前显式给宽度，控件用 `full-width`。
 */
export function segmentedWidth(labels: ReadonlyArray<string>): string {
    const widest = Math.max(0, ...labels.map(emWidth));
    return `calc(${String(Math.ceil(widest * labels.length * 100) / 100)} * var(--text-xs) + ${String(labels.length * 32 + 6)}px)`;
}

/** 只写出有值的字段：控件描述要能原样当作 JSON（Lab 的场景输入），JSON 里没有 undefined。 */
function optional<K extends string>(key: K, value: number | undefined): Partial<Record<K, number>> {
    return value === undefined ? {} : {[key]: value} as Record<K, number>;
}
