/**
 * 服务端进程所属用户的目录（宿主能力 `userDirectoriesKey`）：主目录与系统文档目录。缺省作品目录建在文档目录下
 * （docs/specs/runtime/projects.md 输出第 19 条），`~` 按主目录展开。文档目录按平台找：Windows `%USERPROFILE%\Documents`，
 * macOS `~/Documents`，Linux 先 `~/.config/user-dirs.dirs` 的 `XDG_DOCUMENTS_DIR`、再 `~/Documents`；都解析不到或不存在时为 null。
 * 不跑 `xdg-user-dir` 子进程：它读的就是那个文件。
 */

import {readFile, stat} from "node:fs/promises";
import {join, resolve} from "node:path";

import type {UserDirectories} from "nbook/shared/host";

export interface UserDirectoriesInput {
    readonly platform: NodeJS.Platform;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly home: string;
    /** 目录存在且是目录；缺省查真实文件系统。 */
    readonly isDirectory?: (path: string) => Promise<boolean>;
}

async function realIsDirectory(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isDirectory();
    } catch {
        return false;
    }
}

/** `user-dirs.dirs` 里的一行：`XDG_DOCUMENTS_DIR="$HOME/Documents"`，`$HOME` 换成主目录。 */
export function parseXdgDocumentsDir(text: string, home: string): string | null {
    for (const line of text.split("\n")) {
        const match = /^\s*XDG_DOCUMENTS_DIR\s*=\s*"?([^"\n]*)"?\s*$/u.exec(line);
        if (match === null) continue;
        const value = (match[1] ?? "").replace(/^\$HOME(?=\/|$)/u, home).replace(/^~(?=\/|$)/u, home).trim();
        return value === "" ? null : value;
    }
    return null;
}

export async function resolveUserDirectories(input: UserDirectoriesInput): Promise<UserDirectories> {
    const isDirectory = input.isDirectory ?? realIsDirectory;
    const candidates: string[] = [];
    if (input.platform === "win32") {
        const profile = input.env.USERPROFILE ?? input.home;
        candidates.push(join(profile, "Documents"));
    } else if (input.platform === "darwin") {
        candidates.push(join(input.home, "Documents"));
    } else {
        const configHome = input.env.XDG_CONFIG_HOME ?? join(input.home, ".config");
        try {
            const configured = parseXdgDocumentsDir(await readFile(join(configHome, "user-dirs.dirs"), "utf8"), input.home);
            if (configured !== null) candidates.push(resolve(input.home, configured));
        } catch {
            // 没有这个文件：按惯例找 ~/Documents。
        }
        candidates.push(join(input.home, "Documents"));
    }
    for (const candidate of candidates) {
        if (await isDirectory(candidate)) return {home: input.home, documents: candidate};
    }
    return {home: input.home, documents: null};
}
