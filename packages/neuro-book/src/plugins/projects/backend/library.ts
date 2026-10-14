/**
 * 作品目录（docs/specs/runtime/projects.md 输出第 19 条）：设置里有就用设置（`~` 展开），没有就是系统文档目录下的 `NeuroBook`
 * （解析不到文档目录时是主目录下的 `NeuroBook`）。这里只算路径、不建目录：新建作品时由宿主建。
 */

import {join} from "node:path";

import type {UserDirectories} from "nbook/shared/host";

import {expandHome} from "../shared/paths";

export const DEFAULT_LIBRARY_NAME = "NeuroBook";

export interface EffectiveLibrary {
    readonly path: string;
    readonly source: "setting" | "default";
}

export function effectiveLibrary(setting: string, directories: UserDirectories): EffectiveLibrary {
    const configured = setting.trim();
    if (configured !== "") return {path: expandHome(configured, directories.home), source: "setting"};
    return {path: join(directories.documents ?? directories.home, DEFAULT_LIBRARY_NAME), source: "default"};
}
