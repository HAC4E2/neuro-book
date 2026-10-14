/**
 * 拖动的落点（docs/specs/workbench/files-explorer.md 的“拖动”）：纯函数，输入拖动的源与指针下的落点，给出放下时要做的事。
 * 落点按地址与同层前后项表达，不按行下标：拖动中树变了，放下时按同一份规则重判，只提交与最后显示相同的动作。
 *
 * - 目录行（含根）的中间一段：移入该目录（批量移动）。
 * - 内容文件夹里、与源同一层的两行之间（目录行的上下各四分之一，其余行的上下半）：调整顺序，只改清单。
 * - 其余的行（普通文件夹里的文件行、目录行的上下两段、内容文件夹里不同层的行）：移入这一行所在的文件夹。
 * - 树里行以外的空白：移入源所在方案的根。
 * - 编辑组：在那一组打开源里能打开的项（不是文件操作）。
 * - 落在自己或自己的后代上、移入源都已在的目录、落在缺失条目上：没有落点。
 */

import {isWithin, parentAddress, resourceOf, rootAddress} from "../tree/address";
import type {Row} from "../tree/rows";
import {placeNames} from "./reorder-plan";

/** 指针在行里的位置。 */
export type DropZone = "before" | "inside" | "after";

/** 指针下的落点：一行与在行里的位置、树里行以外的空白，或树外的一个编辑组。 */
export type DropOver =
    | {readonly kind: "row"; readonly id: string; readonly zone: DropZone}
    | {readonly kind: "blank"}
    | {readonly kind: "editor"; readonly group: string};

/** 拖到编辑组时一次最多打开这么多项，多出的不打开（标签上说明）。 */
export const OPEN_LIMIT = 10;

export type DropAction =
    | {readonly kind: "none"}
    | {readonly kind: "move"; readonly target: string}
    | {readonly kind: "reorder"; readonly parent: string; readonly names: ReadonlyArray<string>; readonly anchor: string; readonly zone: "before" | "after"}
    | {readonly kind: "open"; readonly group: string; readonly addresses: ReadonlyArray<string>; readonly skipped: number};

const NONE: DropAction = {kind: "none"};

/** 行里的位置：目录行（含根）分上中下三段（各四分之一、二分之一、四分之一），其余行分上下两半。`offset` 是指针相对行顶的比例。 */
export function zoneOf(row: Row, offset: number): DropZone {
    const directory = row.kind === "root" || (row.kind === "entry" && row.type === "directory");
    if (!directory) return offset < 0.5 ? "before" : "after";
    if (offset < 0.25) return "before";
    if (offset > 0.75) return "after";
    return "inside";
}

const moveInto = (sources: ReadonlyArray<string>, target: string): DropAction => (sources.every((source) => parentAddress(source) === target) ? NONE : {kind: "move", target});

/**
 * 落在一行上。`order` 取内容文件夹这一层清单里的全部条目（按清单顺序），只在调整顺序时用到；不是内容文件夹或还没列出时给
 * `null`。
 */
export function resolveDrop(sources: ReadonlyArray<string>, row: Row | undefined, zone: DropZone, order: (parent: string) => ReadonlyArray<string> | null): DropAction {
    if (row === undefined || sources.length === 0) return NONE;
    if (row.kind !== "root" && row.kind !== "entry") return NONE;
    if (sources.some((source) => isWithin(row.id, source))) return NONE;
    if (row.kind === "root") return row.status.kind === "live" ? moveInto(sources, row.address) : NONE;
    if (row.type === "missing") return NONE;
    if (zone === "inside" && row.type === "directory") return moveInto(sources, row.address);
    const reorder = reorderAt(sources, row, zone, order);
    return reorder ?? moveInto(sources, row.parent);
}

/** 内容文件夹里与全部源同一层、都列在清单里时，两行之间是调整顺序；否则不是（交回“移入这一行所在的文件夹”）。 */
function reorderAt(sources: ReadonlyArray<string>, row: Row & {readonly kind: "entry"}, zone: DropZone, order: (parent: string) => ReadonlyArray<string> | null): DropAction | null {
    if (!row.content || row.listed !== true || zone === "inside" || !sources.every((source) => parentAddress(source) === row.parent)) return null;
    const names = order(row.parent);
    if (names === null) return null;
    const moved = new Set(sources.map((source) => source.slice(source.lastIndexOf("/") + 1)));
    if (![...moved].every((name) => names.includes(name))) return null;
    const at = names.indexOf(row.name);
    // “这一行之后”就是它后面第一个不被拖动的项之前。
    const before = zone === "before" ? row.name : (names.slice(at + 1).find((name) => !moved.has(name)) ?? null);
    const next = placeNames(names, moved, before);
    return next === null ? NONE : {kind: "reorder", parent: row.parent, names: next, anchor: row.id, zone};
}

/** 树里行以外的空白：移入源所在方案的根（源总在同一方案里）；根不是活的时没有落点。 */
export function resolveBlankDrop(sources: ReadonlyArray<string>, rootOf: (address: string) => Row | undefined): DropAction {
    const first = sources[0];
    if (first === undefined) return NONE;
    const root = rootOf(rootAddress(resourceOf(first).scheme));
    return root?.kind === "root" ? resolveDrop(sources, root, "inside", () => null) : NONE;
}

/** 编辑组：源里能打开的项（文件与有正文的节点）依次在那一组打开，目录跳过；超过上限的不打开。 */
export function resolveEditorDrop(sources: ReadonlyArray<string>, group: string, rowOf: (address: string) => Row | undefined): DropAction {
    const opens = sources.flatMap((source) => {
        const row = rowOf(source);
        return row?.kind === "entry" && row.opens !== null ? [row.opens] : [];
    });
    if (opens.length === 0) return NONE;
    return {kind: "open", group, addresses: opens.slice(0, OPEN_LIMIT), skipped: Math.max(0, opens.length - OPEN_LIMIT)};
}
