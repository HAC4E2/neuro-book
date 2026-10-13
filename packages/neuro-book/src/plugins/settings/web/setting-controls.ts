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

/** 只写出有值的字段：控件描述要能原样当作 JSON（Lab 的场景输入），JSON 里没有 undefined。 */
function optional<K extends string>(key: K, value: number | undefined): Partial<Record<K, number>> {
    return value === undefined ? {} : {[key]: value} as Record<K, number>;
}
