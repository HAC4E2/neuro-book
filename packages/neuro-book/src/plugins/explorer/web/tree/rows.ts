/**
 * 树的呈现投影（docs/specs/workbench/files-explorer.md 的“文件夹类型呈现”与“内容文件夹的呈现条件”）：把根、目录缓存
 * 与展开集合按深度优先展开成可见行。只用列出结果，不读正文。
 *
 * 一层目录按内容文件夹呈现，条件是它带内容根且清单状态为 `ok`；内容树里的子目录自身的文件夹类型是普通目录，不能只看
 * 类型。清单不是 `ok` 时退回普通目录的呈现，`index.md` 照常成行。
 *
 * 目录的状态（列出中、读取失败、清单不合法）挂在目录自己的行上（`problem`），不另出状态行；空目录展开后没有行。
 */

import type {DirectoryEntry, FolderKind, Listing} from "nbook/plugins/files/shared/contracts";
import type {Scheme} from "nbook/plugins/files/shared/contracts";

import {childAddress, resourceOf} from "./address";
import type {DirectorySlot, RootState, RootStatus} from "./model";

/** 目录行上的状态：正在列出、读取失败（`code` 是失败码）、清单不合法或读不出（`code` 是清单状态）。 */
export type Problem =
    | {readonly kind: "loading"}
    | {readonly kind: "error" | "manifest"; readonly code: string; readonly detail: string | null};

export interface RootRow {
    readonly kind: "root";
    readonly id: string;
    readonly depth: 0;
    readonly scheme: Scheme;
    readonly address: string;
    readonly expanded: boolean;
    readonly status: RootStatus;
    readonly problem: Problem | null;
}

export interface EntryRow {
    readonly kind: "entry";
    readonly id: string;
    readonly depth: number;
    readonly address: string;
    readonly parent: string;
    readonly name: string;
    /** 显示的名字：内容文件夹里取清单的展示名，缺省真实名字。 */
    readonly label: string;
    /**
     * 名字之后的淡色副标题：展示名与真实名字不同时是真实名字，让路径可辨；内容文件夹与活页夹去掉了类型后缀时是后缀
     * （`.content`、`.binder`）。
     */
    readonly subtitle: string | null;
    readonly icon: string | null;
    readonly type: DirectoryEntry["kind"];
    readonly folder: FolderKind | null;
    /** 这一层按内容文件夹呈现：目录是节点，排序与展示名改清单。 */
    readonly content: boolean;
    /** 内容文件夹里的目录：节点行，打开区打开它的正文。 */
    readonly node: boolean;
    /** 节点有正文（`index.md`）。 */
    readonly body: boolean;
    /** 内容文件夹里是否列在清单中；不在内容文件夹里为 `null`。 */
    readonly listed: boolean | null;
    readonly manifest: boolean;
    /** 活页夹：本应用没有剧情插件，按普通目录显示并提示。 */
    readonly binder: boolean;
    readonly expandable: boolean;
    readonly expanded: boolean;
    /** 打开时的地址：文件本身，或节点的 `index.md`；不能打开为 `null`。 */
    readonly opens: string | null;
    /** 同层的位置（从 1 开始）与同层总数，按完整的同层集合计。 */
    readonly position: number;
    readonly siblings: number;
    /** 在本窗口剪贴板里等着剪切粘贴。 */
    readonly cut: boolean;
    readonly problem: Problem | null;
}

/** 新建时的内联输入行：插在目标目录的第一个子项之前，内容文件夹里插在 `before` 之前。 */
export interface EditRow {
    readonly kind: "edit";
    readonly id: string;
    readonly depth: number;
    readonly parent: string;
    readonly entry: "file" | "directory";
}

export type Row = RootRow | EntryRow | EditRow;

/** 正在新建的项：目标目录、类型与插入位置。 */
export interface Creating {
    readonly parent: string;
    readonly entry: "file" | "directory";
    readonly before: string | null;
}

/** 新建输入行的 id。 */
export function creatingId(parent: string): string {
    return `${parent}#new`;
}

export interface ProjectionInput {
    readonly roots: ReadonlyArray<RootState>;
    readonly slots: ReadonlyMap<string, DirectorySlot>;
    readonly expanded: ReadonlySet<string>;
    readonly showManifests: boolean;
    readonly creating?: Creating | null;
    /** 剪切中的地址：源被改名或移走后地址不再出现，标记随之消失。 */
    readonly cut?: ReadonlySet<string>;
}

export function contentLayer(listing: Listing): boolean {
    return listing.contentRoot !== null && listing.manifest?.status === "ok";
}

export function projectRows(input: ProjectionInput): Row[] {
    const rows: Row[] = [];
    for (const root of input.roots) {
        const expanded = root.status.kind !== "unbound" && input.expanded.has(root.address);
        rows.push({kind: "root", id: root.address, depth: 0, scheme: root.scheme, address: root.address, expanded, status: root.status, problem: expanded ? problemOf(input, root.address) : null});
        if (expanded) directory(input, root.address, 1, rows);
    }
    return rows;
}

/**
 * 一个展开的目录此刻的状态：还没有列出结果为列出中（之前列出失败则为读取失败）；有结果时，刷新失败为读取失败，它是内容根而
 * 清单不合法或读不出为清单问题（清单缺失是普通情形，不算）。收起的目录不看。
 */
function problemOf(input: ProjectionInput, address: string): Problem | null {
    const slot = input.slots.get(address);
    // 读取失败后重新列出：列出期间显示转圈，不再显示上一次的失败。
    if (slot?.error != null && !slot.loading) return {kind: "error", code: slot.error.code, detail: slot.error.detail};
    if (slot?.error != null) return {kind: "loading"};
    if (slot === undefined || slot.listing === null) return {kind: "loading"};
    const {listing} = slot;
    if (listing.contentRoot !== null && listing.contentRoot === resourceOf(address).path && listing.manifest !== undefined && listing.manifest.status !== "ok" && listing.manifest.status !== "absent") {
        return {kind: "manifest", code: listing.manifest.status, detail: listing.manifest.detail};
    }
    return null;
}

/** 内容文件夹与活页夹自己的行：名字去掉类型后缀，后缀作副标题；只有后缀的名字不去。 */
function suffixOf(entry: DirectoryEntry): string | null {
    if (entry.kind !== "directory" || (entry.folder !== "content" && entry.folder !== "binder")) return null;
    const suffix = `.${entry.folder}`;
    return entry.name.endsWith(suffix) && entry.name.length > suffix.length ? suffix : null;
}

function directory(input: ProjectionInput, address: string, depth: number, rows: Row[]): void {
    const slot = input.slots.get(address);
    if (slot === undefined || slot.listing === null) return;
    const {listing} = slot;
    const content = contentLayer(listing);
    const shown = listing.entries.filter((entry) => (entry.role !== "body" || !content) && (entry.role !== "manifest" || input.showManifests));
    const creating = input.creating?.parent === address ? input.creating : null;
    const editRow: EditRow | null = creating === null ? null : {kind: "edit", id: creatingId(address), depth, parent: address, entry: creating.entry};
    const insertAt = editRow === null ? -1 : Math.max(0, creating?.before === null ? 0 : shown.findIndex((entry) => entry.name === creating?.before));
    if (editRow !== null && insertAt >= shown.length) rows.push(editRow);
    shown.forEach((entry, index) => {
        if (index === insertAt && editRow !== null) rows.push(editRow);
        const child = childAddress(address, entry.name);
        const isDirectory = entry.kind === "directory";
        const node = content && isDirectory;
        // 叶子节点（目录里只有正文）没有展开控件；清单不合法时内容树按普通目录显示，叶子标记不算。
        const expandable = isDirectory && !(node && entry.leaf === true);
        const expanded = expandable && input.expanded.has(child);
        const body = node && entry.body === true;
        const titled = content && entry.title !== undefined;
        const suffix = titled ? null : suffixOf(entry);
        const label = titled ? (entry.title as string) : suffix === null ? entry.name : entry.name.slice(0, -suffix.length);
        rows.push({
            kind: "entry",
            id: child,
            depth,
            address: child,
            parent: address,
            name: entry.name,
            label,
            subtitle: suffix ?? (label === entry.name ? null : entry.name),
            icon: content ? (entry.icon ?? null) : null,
            type: entry.kind,
            folder: entry.folder ?? null,
            content,
            node,
            body,
            listed: content ? (entry.listed ?? null) : null,
            manifest: entry.role === "manifest",
            binder: entry.folder === "binder",
            expandable,
            expanded,
            opens: entry.kind === "file" ? child : body ? childAddress(child, "index.md") : null,
            position: index + 1,
            siblings: shown.length,
            cut: input.cut?.has(child) === true,
            problem: expanded ? problemOf(input, child) : null,
        });
        if (expanded) directory(input, child, depth + 1, rows);
    });
}

/**
 * 行上显示的名字：设置“隐藏 Markdown 扩展名”打开时，没有展示名的 `.md` 文件不显示 `.md`（只有扩展名的名字不去）。
 * 改名框与悬停提示用完整名字，不经这里。
 */
export function displayLabel(row: EntryRow, hideMarkdownExtension: boolean): string {
    if (!hideMarkdownExtension || row.type === "directory" || row.label !== row.name) return row.label;
    return /.\.md$/iu.test(row.name) ? row.name.slice(0, -3) : row.label;
}
