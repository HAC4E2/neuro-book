import {createHash} from "node:crypto";
import {once} from "node:events";
import {createReadStream, createWriteStream, mkdirSync, type WriteStream} from "node:fs";
import {mkdir, readFile, rm} from "node:fs/promises";
import {dirname, join} from "node:path";
import {Readable} from "node:stream";
import {finished} from "node:stream/promises";
import {Unzip, UnzipInflate} from "fflate";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {sanitizeZipEntryName} from "nbook/server/backup/backup-archive-rules";

// 恢复服务（Task 112 spec §9.5，已拍板 staging 方案）：下载归档 → 校验 sha256 →
// 流式解包到 State Root 同级 restore-<timestamp>/ → 校验 nb-backup.json。
// 归档如何替换回 State Root 由用户按 UI 指引停机手动完成，运行中进程不覆盖自己的数据。

export type RestoreResult = {
    restoreDir: string;
    fileCount: number;
    appVersion: string;
};

export type RestoreProgress = (phase: "downloading" | "unpacking", done: number, total: number | null) => void;

export class BackupRestoreService {
    /**
     * 下载官方站备份并解包到 restore 目录。expectedSha256 取云端备份元数据（真相源）。
     */
    async restore(input: {
        paths: RuntimePaths;
        siteBaseUrl: string;
        token: string;
        backupId: number;
        expectedSha256: string;
        fileSizeHint: number; // 云端元数据的 fileSize，用于下载进度
        onProgress?: RestoreProgress;
    }): Promise<RestoreResult> {
        const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
        // State Root 同级：Portable 下即 data/ 旁边的 restore-<ts>/
        const restoreDir = join(input.paths.stateRoot, "..", `restore-${timestamp}`);
        const partPath = `${restoreDir}.zip.part`;

        try {
            await this.download(input, partPath);
            const fileCount = await this.unpack(partPath, restoreDir, input.onProgress);
            const appVersion = await this.verifyManifest(restoreDir);
            return {restoreDir, fileCount, appVersion};
        } catch (error) {
            // 失败清理半成品，避免残留误导用户
            await rm(restoreDir, {recursive: true, force: true}).catch(() => undefined);
            throw error;
        } finally {
            await rm(partPath, {force: true}).catch(() => undefined);
        }
    }

    /**
     * 流式下载归档到 part 文件，边写边算 sha256 并与云端元数据比对。
     */
    private async download(
        input: {siteBaseUrl: string; token: string; backupId: number; expectedSha256: string; fileSizeHint: number; onProgress?: RestoreProgress},
        partPath: string,
    ): Promise<void> {
        const response = await fetch(`${input.siteBaseUrl}/api/v1/backups/${input.backupId}/download`, {
            headers: {authorization: `Bearer ${input.token}`},
        });
        if (!response.ok || !response.body) {
            throw new Error(`备份下载失败（HTTP ${response.status}）`);
        }

        const hash = createHash("sha256");
        const out = createWriteStream(partPath);
        let downloaded = 0;
        // Node fetch 的 web ReadableStream 与 node:stream/web 类型声明存在库间差异，经 unknown 桥接
        const body = Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream);
        for await (const chunk of body) {
            const bytes = chunk as Buffer;
            hash.update(bytes);
            downloaded += bytes.length;
            if (!out.write(bytes)) {
                await once(out, "drain");
            }
            input.onProgress?.("downloading", downloaded, input.fileSizeHint || null);
        }
        out.end();
        await finished(out);

        const actual = hash.digest("hex");
        if (actual !== input.expectedSha256) {
            throw new Error("下载的归档 sha256 与云端记录不一致，可能在传输中损坏，请重试");
        }
    }

    /**
     * 流式解包 zip 到 restore 目录；条目名经 zip-slip 防护，非法条目直接失败。
     */
    private async unpack(zipPath: string, restoreDir: string, onProgress?: RestoreProgress): Promise<number> {
        await mkdir(restoreDir, {recursive: true});
        const openStreams = new Set<WriteStream>();
        const streamsDone: Promise<unknown>[] = [];
        let fileCount = 0;
        let failure: Error | null = null;
        // 最近一次写入触发背压的流：推下一块源数据前先等它排空。
        // 用对象持有：赋值发生在 fflate 回调闭包里，直接用 let 会被 TS 流程分析收窄成 null
        const drainRef: {stream: WriteStream | null} = {stream: null};

        const unzip = new Unzip((file) => {
            const safeName = sanitizeZipEntryName(file.name);
            if (safeName === null) {
                failure = failure ?? new Error(`归档包含非法路径条目：${file.name}`);
                return;
            }
            if (file.name.endsWith("/")) {
                mkdirSync(join(restoreDir, safeName), {recursive: true});
                return;
            }
            const targetPath = join(restoreDir, safeName);
            // onfile 回调是同步的，目录创建用同步 API（恢复是后台任务，可接受）
            mkdirSync(dirname(targetPath), {recursive: true});
            const out = createWriteStream(targetPath);
            openStreams.add(out);
            streamsDone.push(finished(out).catch((error: Error) => {
                failure = failure ?? error;
            }));
            fileCount += 1;
            file.ondata = (error, data, final) => {
                if (error) {
                    failure = failure ?? error;
                    out.destroy(error);
                    openStreams.delete(out);
                    return;
                }
                if (!out.write(Buffer.from(data))) {
                    drainRef.stream = out;
                }
                if (final) {
                    out.end();
                    openStreams.delete(out);
                    onProgress?.("unpacking", fileCount, null);
                }
            };
            file.start();
        });
        unzip.register(UnzipInflate);

        const source = createReadStream(zipPath, {highWaterMark: 1 << 18});
        for await (const chunk of source) {
            unzip.push(chunk as Buffer);
            const drainTarget = drainRef.stream;
            if (drainTarget && !drainTarget.destroyed && drainTarget.writableNeedDrain) {
                await once(drainTarget, "drain");
            }
            drainRef.stream = null;
            if (failure) {
                throw failure;
            }
        }
        unzip.push(new Uint8Array(0), true);
        await Promise.all(streamsDone);
        if (failure) {
            throw failure;
        }
        return fileCount;
    }

    /**
     * 校验解包产物的 nb-backup.json（formatVersion 必须为 1），返回归档记录的 appVersion。
     */
    private async verifyManifest(restoreDir: string): Promise<string> {
        let manifest: {formatVersion?: number; appVersion?: string};
        try {
            manifest = JSON.parse(await readFile(join(restoreDir, "nb-backup.json"), "utf8")) as {formatVersion?: number; appVersion?: string};
        } catch {
            throw new Error("归档缺少 nb-backup.json，不是合法的 NeuroBook 备份");
        }
        if (manifest.formatVersion !== 1) {
            throw new Error(`不支持的备份格式版本：${manifest.formatVersion ?? "unknown"}`);
        }
        return manifest.appVersion ?? "unknown";
    }
}
