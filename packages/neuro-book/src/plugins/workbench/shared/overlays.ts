/**
 * 页面浮层的贡献点 `workbench.overlays`（docs/specs/ui/workbench-shell.md 输出 41）：插件交一个组件，工作台在页面根上挂一份，
 * 首页与工作台页都挂。声明是纯数据，前后端都能引用；实现（`load()`）在 `web/contracts.ts`。工作台不认识贡献方，依赖方向是
 * “贡献方 → 工作台”。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";

export const WORKBENCH_OVERLAYS_POINT = "workbench.overlays";

export const OverlayDeclarationSchema = Type.Object({
    /** 几个浮层的挂载顺序（同值按 id）；后挂的在文档里靠后。 */
    order: Type.Optional(Type.Integer({minimum: -1_000_000, maximum: 1_000_000})),
}, {additionalProperties: false});

export type OverlayDeclaration = Static<typeof OverlayDeclarationSchema>;

const OVERLAY_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

/** 只看这一条声明本身。id 规则与视图相同：内置插件写 `nbook.` 开头，其它插件以自己的插件 id 加 `.` 开头。 */
export function validateOverlayContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${WORKBENCH_OVERLAYS_POINT} 只接受浏览器入口的贡献`;
    const id = descriptor.id;
    if (id.length > 128 || !OVERLAY_ID.test(id)) return `浮层 id 必须是点分的小写段、至多 128 个字符：${id}`;
    const prefix = descriptor.plugin.startsWith("nbook.") ? "nbook." : `${descriptor.plugin}.`;
    if (!id.startsWith(prefix)) return `插件 ${descriptor.plugin} 的浮层 id 必须以 ${prefix} 开头：${id}`;
    if (!Value.Check(OverlayDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(OverlayDeclarationSchema, descriptor.declaration)][0];
        return `浮层 ${id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
    }
    return null;
}
