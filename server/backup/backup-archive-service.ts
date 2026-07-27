import {createHash, randomUUID} from "node:crypto";
import {once} from "node:events";
import {createReadStream, createWriteStream} from "node:fs";
import {copyFile, mkdir, readdir, readFile, stat} from "node:fs/promises";
import {join} from "node:path";
import {finished} from "node:stream/promises";
import {createClient} from "@libsql/client";
import {strToU8, Zip, ZipDeflate} from "fflate";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {isSqliteFile, shouldExcludeFromBackup} from "nbook/server/backup/backup-archive-rules";

// State Root 归档服务（Task 112 spec §9.4）：范围 = workspace/ + config.yaml + .env；
// 排除 logs/、锁/临时/wal/shm；SQLite 经 VACUUM INTO 冷快照保证一致性；
// fflate 流式打包（边写边算 sha256，不持大 buffer）。

export type BackupArchiveResult = {
    zipPath: string;
    sha256: string; // hex 小写
    fileSize: number;
    fileCount: number;
    appVersion: string;
    warnings: string[]; // 非致命告警（如快照失败退化为原样拷贝）
};

export type ArchiveProgress = (done: number, total: number) => void;

/**
 * 读取当前应用版本（Product Root 优先根 package，`.output` runner 退回 server package）。
 */
async function readAppVersion(): Promise<string> {
    for (const path of [join(process.cwd(), "package.json"), join(process.cwd(), ".output", "server", "package.json")]) {
        try {
            const manifest = JSON.parse(await readFile(path, "utf8")) as {version?: string};
            if (manifest.version) {
                return manifest.version;
            }
        } catch {
            continue;
        }
    }
    return "unknown";
}

/**
 * 递归收集目录下全部文件的相对路径（/ 分隔，前缀 prefix）。
 */
async function collectFiles(dir: string, prefix: string, out: string[]): Promise<void> {
    let entries;
    try {
        entries = await readdir(dir, {withFileTypes: true});
    } catch {
        return; // 目录不存在（如全新实例无 workspace 子目录）
    }
    for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (shouldExcludeFromBackup(relative)) {
            continue;
        }
        if (entry.isDirectory()) {
            await collectFiles(join(dir, entry.name), relative, out);
        } else if (entry.isFile()) {
            out.push(relative);
        }
    }
}

/**
 * 对 SQLite 文件产出一致性冷快照（VACUUM INTO，独立连接、目标必须不存在）。
 */
async function snapshotSqlite(sourcePath: string, snapshotDir: string): Promise<string> {
    const target = join(snapshotDir, `${randomUUID()}.sqlite`);
    const client = createClient({url: `file:${sourcePath.replaceAll("\\", "/")}`});
    try {
        await client.execute(`VACUUM INTO '${target.replaceAll("\\", "/").replaceAll("'", "''")}'`);
    } finally {
        client.close();
    }
    return target;
}

export class BackupArchiveService {
    /**
     * 打包整个 State Root 到 tmpDir 下的 zip。zip 根含 nb-backup.json
     * （{formatVersion:1, appVersion, createdAt, encryption:"none"}）。
     */
    async createArchive(paths: RuntimePaths, tmpDir: string, onProgress?: ArchiveProgress): Promise<BackupArchiveResult> {
        await mkdir(tmpDir, {recursive: true});
        const snapshotDir = join(tmpDir, "sqlite-snapshots");
        await mkdir(snapshotDir, {recursive: true});
        const warnings: string[] = [];

        // 收集打包清单：workspace/ 全量 + State Root 顶层 config.yaml / .env
        const files: string[] = [];
        await collectFiles(paths.workspaceRoot, "workspace", files);
        for (const topLevel of ["config.yaml", ".env"]) {
            try {
                if ((await stat(join(paths.stateRoot, topLevel))).isFile()) {
                    files.push(topLevel);
                }
            } catch {
                // 不存在则跳过（dev 环境常无 config.yaml）
            }
        }

        const zipPath = join(tmpDir, "backup.zip");
        const out = createWriteStream(zipPath);
        const hash = createHash("sha256");
        let fileSize = 0;
        let zipError: Error | null = null;
        const zip = new Zip((error, data, final) => {
            if (error) {
                zipError = error;
                out.destroy(error);
                return;
            }
            hash.update(data);
            fileSize += data.length;
            out.write(Buffer.from(data));
            if (final) {
                out.end();
            }
        });

        /** 写流背压：fflate 是同步推送，推完一块后按需等待落盘缓冲排空 */
        const drainIfNeeded = async (): Promise<void> => {
            if (out.writableNeedDrain) {
                await once(out, "drain");
            }
            if (zipError) {
                throw zipError;
            }
        };

        /** 新增一个 zip 条目并推入全部字节 */
        const addEntry = async (entryName: string, sourcePath: string): Promise<void> => {
            const entry = new ZipDeflate(entryName, {level: 6});
            zip.add(entry);
            const source = createReadStream(sourcePath, {highWaterMark: 1 << 18});
            for await (const chunk of source) {
                entry.push(chunk as Buffer);
                await drainIfNeeded();
            }
            entry.push(new Uint8Array(0), true);
            await drainIfNeeded();
        };

        const appVersion = await readAppVersion();
        try {
            // 归档自述文件放 zip 根（spec §9.4）
            const manifestEntry = new ZipDeflate("nb-backup.json", {level: 6});
            zip.add(manifestEntry);
            manifestEntry.push(strToU8(JSON.stringify({
                formatVersion: 1,
                appVersion,
                createdAt: new Date().toISOString(),
                encryption: "none",
            }, null, 4)), true);
            await drainIfNeeded();

            let done = 0;
            for (const relative of files) {
                const absolute = join(paths.stateRoot, relative);
                let sourcePath = absolute;
                if (isSqliteFile(relative)) {
                    try {
                        sourcePath = await snapshotSqlite(absolute, snapshotDir);
                    } catch (error) {
                        // 快照失败退化为原样拷贝（可能包含未 checkpoint 的写入），记录告警不中断
                        warnings.push(`SQLite 快照失败，已按原文件打包：${relative}（${error instanceof Error ? error.message : String(error)}）`);
                        const fallback = join(snapshotDir, `${randomUUID()}.raw`);
                        await copyFile(absolute, fallback);
                        sourcePath = fallback;
                    }
                }
                await addEntry(relative, sourcePath);
                done += 1;
                onProgress?.(done, files.length);
            }

            zip.end();
            await finished(out);
        } catch (error) {
            out.destroy();
            throw error;
        }

        return {zipPath, sha256: hash.digest("hex"), fileSize, fileCount: files.length, appVersion, warnings};
    }
}
