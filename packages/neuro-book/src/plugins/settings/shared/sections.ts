/**
 * 设置分区贡献点 `settings.sections` 的声明与登记校验（docs/specs/settings/settings-window.md“输入与前置条件”）。
 * 声明是纯数据，前后端都能引用；page 分区的实现（`load()`）与页面上下文依赖 Vue，在 `web/contracts.ts`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";

import {LocalizedTextSchema} from "nbook/shared/localized-text";
import {isSettingsGroupId, isSettingsSectionId, SETTINGS_ORDER_LIMIT, SETTINGS_SECTION_ID_MAX_LENGTH} from "nbook/shared/settings";

export const SETTINGS_SECTIONS_POINT = "settings.sections";

/** 左栏的三组，自上而下：应用、AI、插件。 */
export const SETTINGS_SECTION_CATEGORIES = ["app", "ai", "plugins"] as const;

export type SettingsSectionCategory = (typeof SETTINGS_SECTION_CATEGORIES)[number];

const Layer = Type.Union([Type.Literal("user"), Type.Literal("project")]);

export const SettingsSectionDeclarationSchema = Type.Object({
    title: LocalizedTextSchema,
    description: Type.Optional(LocalizedTextSchema),
    icon: Type.String({pattern: "\\S"}),
    category: Type.Union([Type.Literal("app"), Type.Literal("ai"), Type.Literal("plugins")]),
    order: Type.Optional(Type.Number({minimum: -SETTINGS_ORDER_LIMIT, maximum: SETTINGS_ORDER_LIMIT})),
    kind: Type.Union([Type.Literal("list"), Type.Literal("page")]),
    groups: Type.Optional(Type.Array(Type.Object({id: Type.String(), title: LocalizedTextSchema}, {additionalProperties: false}))),
    layout: Type.Optional(Type.Union([Type.Literal("column"), Type.Literal("fill")])),
    layers: Type.Optional(Type.Array(Layer, {minItems: 1})),
}, {additionalProperties: false});

export type SettingsSectionDeclaration = Static<typeof SettingsSectionDeclarationSchema>;

/**
 * `settings.sections` 的登记校验：只看这一条声明本身。id 规则同视图：内置插件写 `nbook.<名>`，其它插件以自己的插件
 * id 加 `.` 开头。`groups` 只给 list，`layout`、`layers` 只给 page；配置项指向的分区与小组存不存在不在这里核对。
 */
export function validateSectionContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${SETTINGS_SECTIONS_POINT} 只接受浏览器入口的贡献`;
    const id = descriptor.id;
    if (!isSettingsSectionId(id)) return `分区 id 必须是点分的小写段、至多 ${String(SETTINGS_SECTION_ID_MAX_LENGTH)} 个字符：${id}`;
    const prefix = descriptor.plugin.startsWith("nbook.") ? "nbook." : `${descriptor.plugin}.`;
    if (!id.startsWith(prefix)) return `插件 ${descriptor.plugin} 的分区 id 必须以 ${prefix} 开头：${id}`;
    if (!Value.Check(SettingsSectionDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(SettingsSectionDeclarationSchema, descriptor.declaration)][0];
        return `分区 ${id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
    }
    const declaration = descriptor.declaration as SettingsSectionDeclaration;
    if (declaration.kind === "list") {
        if (declaration.layout !== undefined || declaration.layers !== undefined) return `分区 ${id} 是 list，不能写 layout 或 layers`;
        const ids = (declaration.groups ?? []).map((group) => group.id);
        const malformed = ids.find((group) => !isSettingsGroupId(group));
        if (malformed !== undefined) return `分区 ${id} 的小组 id 必须是一个小写段：${malformed}`;
        if (new Set(ids).size !== ids.length) return `分区 ${id} 的小组 id 有重复`;
    } else {
        if (declaration.groups !== undefined) return `分区 ${id} 是 page，不能写 groups`;
        if (declaration.layers !== undefined && new Set(declaration.layers).size !== declaration.layers.length) return `分区 ${id} 的 layers 有重复`;
    }
    return null;
}
