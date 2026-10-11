/**
 * 用户目录（docs/specs/runtime/projects.md 输入与前置条件“用户目录”）：三个平台的文档目录怎么找；找不到为 null。
 * 文件系统查询注入，平台与环境变量注入；`user-dirs.dirs` 用真实临时目录里的真实文件。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {parseXdgDocumentsDir, resolveUserDirectories} from "./user-directories";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-server", "user-directories");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const existing = (...paths: string[]) => async (path: string): Promise<boolean> => paths.includes(path);

describe("用户目录", () => {
    it("Windows 取 %USERPROFILE%\\Documents，没有 USERPROFILE 时取主目录下的；不存在为 null", async () => {
        expect(await resolveUserDirectories({platform: "win32", env: {USERPROFILE: "C:\\Users\\writer"}, home: "C:\\Users\\writer", isDirectory: existing(join("C:\\Users\\writer", "Documents"))}))
            .toEqual({home: "C:\\Users\\writer", documents: join("C:\\Users\\writer", "Documents")});
        expect(await resolveUserDirectories({platform: "win32", env: {}, home: "/home/w", isDirectory: existing()})).toEqual({home: "/home/w", documents: null});
    });

    it("macOS 取 ~/Documents", async () => {
        expect(await resolveUserDirectories({platform: "darwin", env: {}, home: "/Users/writer", isDirectory: existing("/Users/writer/Documents")})).toEqual({home: "/Users/writer", documents: "/Users/writer/Documents"});
    });

    it("Linux 先读 user-dirs.dirs（真实文件，$HOME 换成主目录），没有或不存在时退到 ~/Documents", async () => {
        const home = join(tmp, "home");
        await mkdir(join(home, ".config"), {recursive: true});
        await mkdir(join(home, "文档"), {recursive: true});
        await writeFile(join(home, ".config", "user-dirs.dirs"), '# 注释\nXDG_DESKTOP_DIR="$HOME/桌面"\nXDG_DOCUMENTS_DIR="$HOME/文档"\n');
        expect(await resolveUserDirectories({platform: "linux", env: {}, home})).toEqual({home, documents: join(home, "文档")});

        const other = join(tmp, "home-2");
        await mkdir(join(other, "Documents"), {recursive: true});
        expect(await resolveUserDirectories({platform: "linux", env: {}, home: other})).toEqual({home: other, documents: join(other, "Documents")});

        const bare = join(tmp, "home-3");
        await mkdir(bare, {recursive: true});
        expect(await resolveUserDirectories({platform: "linux", env: {}, home: bare})).toEqual({home: bare, documents: null});
    });

    it("parseXdgDocumentsDir 认带引号与不带引号的写法，空值为 null", () => {
        expect(parseXdgDocumentsDir('XDG_DOCUMENTS_DIR="$HOME/Documents"', "/h")).toBe("/h/Documents");
        expect(parseXdgDocumentsDir("XDG_DOCUMENTS_DIR=/data/docs", "/h")).toBe("/data/docs");
        expect(parseXdgDocumentsDir('XDG_DOCUMENTS_DIR=""', "/h")).toBeNull();
        expect(parseXdgDocumentsDir("XDG_MUSIC_DIR=\"$HOME/Music\"", "/h")).toBeNull();
    });
});
