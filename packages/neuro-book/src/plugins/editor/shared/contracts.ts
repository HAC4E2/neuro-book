/**
 * `nbook.editor` 对其它插件公开的合同（docs/specs/workbench/editor.md 的“输入与前置条件”）：文档协调服务，资源管理器
 * 在复制、移动、改名与删除前经它结算未保存的修改；页面贡献点 `editor.pages`（输出 33），欢迎页这类不对应文件的标签；编辑区标题的
 * 菜单位置 `editor.title`（输出 34）。其它插件在运行时只引用本文件。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import {MENU_BUTTON, MENU_EXTENSIONS, menuItemValidator, menuLocation} from "nbook/plugins/commands/shared/contracts";
import type {MenuItemDeclaration} from "nbook/plugins/commands/shared/contracts";
import {LocalizedTextSchema} from "nbook/shared/localized-text";

/** 需要结算的文档此刻的状态：dirty、在保存、有未裁决输入、磁盘冲突。 */
export type SettleState = "dirty" | "saving" | "unresolved" | "conflict";

export interface AffectedDocument {
    readonly address: string;
    readonly state: SettleState;
}

/** 文件操作期间挡住受影响文档的新保存（保存排队、输入照常）。 */
export interface DocumentLease {
    /**
     * 操作结束：`done` 时成功移动的项按实际目标改地址，租约释放；`unknown`（结果未知）时租约保持，资源管理器核对或
     * 放弃后再以 `done` 结束。重复结束无效。
     */
    end(result: {readonly kind: "done"; readonly moved?: ReadonlyArray<{readonly from: string; readonly to: string}>} | {readonly kind: "unknown"}): void;
}

export type LeaseResult =
    | {readonly ok: true; readonly lease: DocumentLease}
    | {readonly ok: false; readonly reason: "blocked"; readonly documents: ReadonlyArray<AffectedDocument>};

export interface DocumentCoordinator {
    /** 地址本身或其后代里需要结算的文档。 */
    affected(addresses: ReadonlyArray<string>): ReadonlyArray<AffectedDocument>;
    /** 结算这些文档的视图输入、等在途保存，再挡住它们的新保存；有未裁决输入或磁盘冲突时为 blocked，不取租约。 */
    begin(addresses: ReadonlyArray<string>): Promise<LeaseResult>;
    /** 保存这些地址下的 dirty 文档，逐项结果；有未裁决输入或磁盘冲突的项不保存、为失败。 */
    save(addresses: ReadonlyArray<string>): Promise<ReadonlyArray<{readonly address: string; readonly ok: boolean; readonly code?: string}>>;
    /** 本窗口的保存形成了从 `token` 起的目录项身份链时返回链尾的令牌，否则原样返回。 */
    translate(address: string, token: string): string;
    /** 用户确认删除并删除成功后：关闭这些地址及其后代的文档与标签、丢弃正文。 */
    close(addresses: ReadonlyArray<string>): void;
}

export const documentCoordinatorKey: ServiceKey<DocumentCoordinator> = defineServiceKey<DocumentCoordinator>("nbook.editor/documents");

export const EDITOR_PAGES_POINT = "editor.pages";

/**
 * 编辑区标题的菜单位置（docs/specs/workbench/editor.md 输出 34，菜单项的共同规则见 docs/specs/workbench/menus.md）：活动编辑组
 * 标签条右侧的按钮与“⋯”。当前文件是活动组的活动标签（是文件时），`context: "resource"` 的项执行时收到 `{address}`。
 */
export const EDITOR_TITLE_POINT = "editor.title";

export type EditorTitleItemDeclaration = MenuItemDeclaration;

export const editorTitleLocation = menuLocation(EDITOR_TITLE_POINT, {...MENU_BUTTON, ...MENU_EXTENSIONS}, {contexts: ["resource"], buttons: true});

export const validateEditorTitleItem = menuItemValidator(editorTitleLocation);

/** 按 id 打开一个页面（同一页面在窗口里只开一个，已开就切过去）。 */
export const OPEN_PAGE_COMMAND = "nbook.editor.open-page";

/**
 * 页面的声明。页面标签不进会话记录，刷新后不恢复；`openOnFirstVisit` 的页面在这部作品第一次在本窗口打开（还没有编辑器
 * 会话记录）时自动打开。实现（`load()`）与页面组件收到的上下文在 `web/pages.ts`。
 */
export const EditorPageDeclarationSchema = Type.Object({
    title: LocalizedTextSchema,
    icon: Type.String({pattern: "\\S"}),
    openOnFirstVisit: Type.Optional(Type.Boolean()),
}, {additionalProperties: false});

export type EditorPageDeclaration = Static<typeof EditorPageDeclarationSchema>;

const PAGE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

/** 页面 id 的规则与视图相同：内置插件写 `nbook.` 开头，其它插件以自己的插件 id 加 `.` 开头。 */
export function validateEditorPageContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${EDITOR_PAGES_POINT} 只接受浏览器入口的贡献`;
    const prefix = descriptor.plugin.startsWith("nbook.") ? "nbook." : `${descriptor.plugin}.`;
    if (!PAGE_ID.test(descriptor.id) || !descriptor.id.startsWith(prefix)) return `插件 ${descriptor.plugin} 的页面 id 必须是点分的小写段、以 ${prefix} 开头：${descriptor.id}`;
    if (!Value.Check(EditorPageDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(EditorPageDeclarationSchema, descriptor.declaration)][0];
        return `页面 ${descriptor.id} 的声明不合格：${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}：${first.message}`}`;
    }
    return null;
}
