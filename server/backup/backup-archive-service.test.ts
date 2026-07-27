import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {strFromU8, unzipSync} from "fflate";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {BackupArchiveService} from "nbook/server/backup/backup-archive-service";

// 归档服务端到端：假 State Root（含真实 SQLite）打包 → 解包断言条目集、
// 排除规则生效、SQLite 走冷快照、nb-backup.json 合法、sha256 与产物一致。

let fixtureRoot = "";
let tmpDir = "";

beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "nbook-archive-fixture-"));
    tmpDir = await mkdtemp(join(tmpdir(), "nbook-archive-out-"));

    // 假 State Root：workspace 正文 + 应用库（真 SQLite）+ 顶层 config/.env + 应排除物
    await mkdir(join(fixtureRoot, "workspace", "novel-a", "manuscript"), {recursive: true});
    await mkdir(join(fixtureRoot, "workspace", ".nbook"), {recursive: true});
    await mkdir(join(fixtureRoot, "logs"), {recursive: true});
    await writeFile(join(fixtureRoot, "workspace", "novel-a", "manuscript", "chapter-1.md"), "# 第一章\n正文内容");
    await writeFile(join(fixtureRoot, "workspace", "novel-a", "draft.tmp"), "temp");
    await writeFile(join(fixtureRoot, "workspace", "novel-a", "editor.lock"), "lock");
    await writeFile(join(fixtureRoot, "logs", "app.log"), "log line");
    await writeFile(join(fixtureRoot, "config.yaml"), "auth:\n  enabled: true\n");
    await writeFile(join(fixtureRoot, ".env"), "SECRET=1\n");

    const dbPath = join(fixtureRoot, "workspace", ".nbook", "neuro-book.sqlite").replaceAll("\\", "/");
    const client = createClient({url: `file:${dbPath}`});
    await client.execute("CREATE TABLE demo (id INTEGER PRIMARY KEY, name TEXT)");
    await client.execute("INSERT INTO demo (name) VALUES ('hello')");
    client.close();
});

afterAll(async () => {
    await rm(fixtureRoot, {recursive: true, force: true}).catch(() => undefined);
    await rm(tmpDir, {recursive: true, force: true}).catch(() => undefined);
});

describe("BackupArchiveService", () => {
    it("打包整个 State Root：条目集正确、排除生效、sha256 一致、SQLite 快照可用", async () => {
        const paths = createRuntimePaths({
            applicationRoot: absoluteFsPath(fixtureRoot),
            stateRoot: absoluteFsPath(fixtureRoot),
        });
        const progress: Array<[number, number]> = [];
        const result = await new BackupArchiveService().createArchive(paths, tmpDir, (done, total) => progress.push([done, total]));

        expect(result.warnings).toEqual([]);
        expect(result.fileCount).toBe(4); // chapter-1.md + neuro-book.sqlite + config.yaml + .env
        expect(progress.at(-1)).toEqual([4, 4]);

        const zipBytes = await readFile(result.zipPath);
        expect(zipBytes.byteLength).toBe(result.fileSize);
        expect(createHash("sha256").update(zipBytes).digest("hex")).toBe(result.sha256);

        const entries = unzipSync(new Uint8Array(zipBytes));
        expect(Object.keys(entries).sort()).toEqual([
            ".env",
            "config.yaml",
            "nb-backup.json",
            "workspace/.nbook/neuro-book.sqlite",
            "workspace/novel-a/manuscript/chapter-1.md",
        ]);

        const manifest = JSON.parse(strFromU8(entries["nb-backup.json"] as Uint8Array)) as {formatVersion: number; encryption: string};
        expect(manifest.formatVersion).toBe(1);
        expect(manifest.encryption).toBe("none");

        // SQLite 快照是能打开的一致性数据库
        const snapshotPath = join(tmpDir, "restored.sqlite");
        await writeFile(snapshotPath, entries["workspace/.nbook/neuro-book.sqlite"] as Uint8Array);
        const client = createClient({url: `file:${snapshotPath.replaceAll("\\", "/")}`});
        const rows = await client.execute("SELECT name FROM demo");
        client.close();
        expect(rows.rows[0]?.name).toBe("hello");
    });
});
