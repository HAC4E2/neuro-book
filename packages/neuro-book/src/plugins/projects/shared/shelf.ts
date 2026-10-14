/**
 * 书架上一部作品的界面类型（docs/specs/workbench/bookshelf.md）：schema 在 `contracts.ts`（远程合同 `shelf` 的输出），这里
 * 只把类型与显示名的规则交给组件。统计只读缓存，`freshness` 说明它是不是最新的，界面不把旧快照当实时值。
 */

import {projectFolderName} from "nbook/shared/projects";

export type {ShelfFreshness, ShelfItem, ShelfLastEdit, ShelfStats} from "./contracts";

/** 作品的显示名：书名优先，没有时用目录原名（短名只用在地址栏）。书架与“打开项目”的列表都经它；窗口里的显示名由引导响应给出。 */
export function projectDisplayName(project: {readonly title: string | null; readonly path: string}): string {
    return project.title ?? projectFolderName(project.path);
}
