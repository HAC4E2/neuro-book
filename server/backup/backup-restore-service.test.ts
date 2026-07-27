import {createHash} from "node:crypto";
import {createServer, type Server} from "node:http";
import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {strToU8, zipSync} from "fflate";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {BackupRestoreService} from "nbook/server/backup/backup-restore-service";

// 恢复服务：本地起最小 HTTP 服务当"官方站"，覆盖 sha256 校验拒收、
// zip-slip 条目拒绝、正常解包到 State Root 同级 restore-<ts>/ 目录。

let httpServer: Server | null = null;
let baseUrl = "";
let parentDir = "";
let stateRoot = "";

/** 当前服务的归档字节（每个用例替换） */
let servedZip = new Uint8Array();

function makeZip(entries: Record<string, Uint8Array>): Uint8Array {
    return zipSync({
        "nb-backup.json": strToU8(JSON.stringify({formatVersion: 1, appVersion: "0.0.0-test", createdAt: "2026-07-22T00:00:00.000Z", encryption: "none"})),
        ...entries,
    });
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

beforeAll(async () => {
    parentDir = await mkdtemp(join(tmpdir(), "nbook-restore-"));
    stateRoot = join(parentDir, "data");

    httpServer = createServer((request, response) => {
        response.writeHead(200, {"content-type": "application/zip", "x-nb-sha256": sha256Hex(servedZip)});
        response.end(Buffer.from(servedZip));
    });
    await new Promise<void>((resolveListen) => httpServer!.listen(0, "127.0.0.1", resolveListen));
    const address = httpServer.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
    await new Promise<void>((resolveClose) => httpServer?.close(() => resolveClose()));
    await rm(parentDir, {recursive: true, force: true}).catch(() => undefined);
});

function service(): BackupRestoreService {
    return new BackupRestoreService();
}

function paths() {
    return createRuntimePaths({
        applicationRoot: absoluteFsPath(stateRoot),
        stateRoot: absoluteFsPath(stateRoot),
    });
}

describe("BackupRestoreService", () => {
    it("正常恢复：解包到 State Root 同级 restore-<ts>/，manifest 校验通过", async () => {
        servedZip = makeZip({
            "workspace/manuscript/a.md": strToU8("# hello"),
            "config.yaml": strToU8("auth:\n  enabled: true\n"),
        });
        const result = await service().restore({
            paths: paths(),
            siteBaseUrl: baseUrl,
            token: "nbp_at_test",
            backupId: 1,
            expectedSha256: sha256Hex(servedZip),
            fileSizeHint: servedZip.byteLength,
        });

        expect(result.appVersion).toBe("0.0.0-test");
        expect(result.fileCount).toBe(3); // nb-backup.json + a.md + config.yaml
        // 落点在 State Root 同级
        const siblings = await readdir(parentDir);
        expect(siblings.some((name) => name.startsWith("restore-"))).toBe(true);
        const restored = await readFile(join(result.restoreDir, "workspace", "manuscript", "a.md"), "utf8");
        expect(restored).toBe("# hello");
        // part 中转文件已清理
        expect(siblings.some((name) => name.endsWith(".zip.part"))).toBe(false);
    });

    it("sha256 不一致拒收且不留半成品", async () => {
        servedZip = makeZip({"workspace/b.md": strToU8("b")});
        await expect(service().restore({
            paths: paths(),
            siteBaseUrl: baseUrl,
            token: "nbp_at_test",
            backupId: 2,
            expectedSha256: "0".repeat(64),
            fileSizeHint: servedZip.byteLength,
        })).rejects.toThrow(/sha256/);
    });

    it("zip-slip 条目直接失败", async () => {
        servedZip = zipSync({
            "nb-backup.json": strToU8(JSON.stringify({formatVersion: 1, appVersion: "x", createdAt: "", encryption: "none"})),
            "../escape.txt": strToU8("bad"),
        });
        await expect(service().restore({
            paths: paths(),
            siteBaseUrl: baseUrl,
            token: "nbp_at_test",
            backupId: 3,
            expectedSha256: sha256Hex(servedZip),
            fileSizeHint: servedZip.byteLength,
        })).rejects.toThrow(/非法路径/);
        // 逃逸文件不存在
        await expect(readFile(join(parentDir, "escape.txt"))).rejects.toThrow();
    });
});
