import {lstat, mkdir, mkdtemp, readdir, readFile, rm, rmdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {isProcessAlive, TEST_RUN_ID_ENV} from "./process";
export const TMP_ROOT_REL = ".agent/tmp";
/** owner marker 文件名。 */
export const TMP_MARKER_FILE = ".nbook-tmp.json";
/** marker 结构版本；sweep 只回收版本一致的 root。 */
export const TMP_MARKER_SCHEMA_VERSION = 1;
/** 保守回收窗口：超过该时长且 owner 已死才允许回收。 */
export const TMP_STALE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 测试临时根目录的 owner marker。 */
export type TestTmpRootMarker = {
    schemaVersion: number;
    createdAt: string;
    pid: number;
    runId: string;
    purpose: string;
};

/** sweep 判定保留某个 root 的原因。 */
export type TmpSweepRetainReason = "no_marker" | "schema_mismatch" | "owner_alive" | "within_window" | "unreadable";

export type TmpSweepReport = {
    removed: string[];
    retained: {root: string; reason: TmpSweepRetainReason}[];
    failures: {root: string; message: string}[];
};

/** fixture root 的前缀；sweep 只认这些前缀。 */
export const FIXTURE_ROOT_PREFIX = "nbook-workspace-assets-";
/** run 级共享 system assets snapshot 的前缀。 */
export const SNAPSHOT_ROOT_PREFIX = "nbook-workspace-snapshot-";
/** fixture owner marker 文件名。 */
export const FIXTURE_MARKER_FILE = ".nbook-fixture.json";
/** fixture marker 结构版本。 */
export const FIXTURE_MARKER_SCHEMA_VERSION = 1;
/** fixture 保守回收窗口。 */
export const FIXTURE_STALE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type SystemAssetsMode = "shared" | "isolated";

/** fixture owner marker；只描述清理所需的通用元数据。 */
export type TestWorkspaceFixtureMarker = {
    schemaVersion: number;
    createdAt: string;
    pid: number;
    runId: string;
    purpose: string;
    systemAssets: SystemAssetsMode;
};

export type FixtureSweepRetainReason = "no_marker" | "schema_mismatch" | "owner_alive" | "within_window" | "unreadable";

export type FixtureSweepReport = {
    removed: string[];
    retained: {root: string; reason: FixtureSweepRetainReason}[];
    failures: {root: string; message: string}[];
};

/** 解析 `.agent/tmp` 在指定宿主根中的绝对路径。 */
export function resolveTmpRoot(repoRoot: string): string {
    return resolve(repoRoot, TMP_ROOT_REL);
}

/** 新建测试临时根并写 owner marker。 */
export async function createTestTmpRoot(repoRoot: string, name: string, purpose?: string): Promise<string> {
    const tmpRoot = resolveTmpRoot(repoRoot);
    await mkdir(tmpRoot, {recursive: true});
    const root = await mkdtemp(resolve(tmpRoot, `${name}-`));
    await writeTmpMarker(root, {
        schemaVersion: TMP_MARKER_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        pid: process.pid,
        runId: process.env[TEST_RUN_ID_ENV] ?? randomUUID(),
        purpose: purpose ?? `test-${name}`,
    });
    return root;
}

/** 回收超时且 owner 已死的测试临时根；无法证明安全的条目一律保留。 */
export async function sweepStaleTmpRoots(repoRoot: string, now: number = Date.now()): Promise<TmpSweepReport> {
    const report: TmpSweepReport = {removed: [], retained: [], failures: []};
    const tmpRoot = resolveTmpRoot(repoRoot);
    const entries = await readdir(tmpRoot, {withFileTypes: true}).catch(() => []);
    for (const entry of entries) {
        const root = resolve(tmpRoot, entry.name);
        const stats = await lstat(root).catch(() => null);
        if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
            report.retained.push({root, reason: "unreadable"});
            continue;
        }
        const marker = await readTmpMarker(root);
        if (marker === null) {
            if (now - stats.mtimeMs < TMP_STALE_WINDOW_MS) {
                report.retained.push({root, reason: "within_window"});
                continue;
            }
        } else {
            if (marker.schemaVersion !== TMP_MARKER_SCHEMA_VERSION) {
                report.retained.push({root, reason: "schema_mismatch"});
                continue;
            }
            const createdAt = Date.parse(marker.createdAt);
            if (!Number.isFinite(createdAt) || now - createdAt < TMP_STALE_WINDOW_MS) {
                report.retained.push({root, reason: "within_window"});
                continue;
            }
            if (isProcessAlive(marker.pid)) {
                report.retained.push({root, reason: "owner_alive"});
                continue;
            }
        }
        try {
            await removeFixtureTree(root);
            report.removed.push(root);
        } catch (error) {
            report.failures.push({root, message: error instanceof Error ? error.message : String(error)});
        }
    }
    return report;
}

export async function sweepStaleFixtureRoots(now: number = Date.now()): Promise<FixtureSweepReport> {
    const report: FixtureSweepReport = {removed: [], retained: [], failures: []};
    const tempRoot = tmpdir();
    const entries = await readdir(tempRoot, {withFileTypes: true}).catch(() => []);
    for (const entry of entries) {
        if (!entry.name.startsWith(FIXTURE_ROOT_PREFIX) && !entry.name.startsWith(SNAPSHOT_ROOT_PREFIX)) continue;
        const root = resolve(tempRoot, entry.name);
        const stats = await lstat(root).catch(() => null);
        if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
            report.retained.push({root, reason: "unreadable"});
            continue;
        }
        const marker = await readFixtureMarker(root);
        if (!marker) {
            report.retained.push({root, reason: "no_marker"});
            continue;
        }
        if (marker.schemaVersion !== FIXTURE_MARKER_SCHEMA_VERSION) {
            report.retained.push({root, reason: "schema_mismatch"});
            continue;
        }
        const createdAt = Date.parse(marker.createdAt);
        if (!Number.isFinite(createdAt) || now - createdAt < FIXTURE_STALE_WINDOW_MS) {
            report.retained.push({root, reason: "within_window"});
            continue;
        }
        if (isProcessAlive(marker.pid)) {
            report.retained.push({root, reason: "owner_alive"});
            continue;
        }
        try {
            await removeFixtureTree(root);
            report.removed.push(root);
        } catch (error) {
            report.failures.push({root, message: error instanceof Error ? error.message : String(error)});
        }
    }
    return report;
}

/** 写入通用测试临时根 marker。 */
export async function writeTmpMarker(root: string, marker: TestTmpRootMarker): Promise<void> {
    await writeFile(resolve(root, TMP_MARKER_FILE), `${JSON.stringify(marker, null, 4)}\n`, "utf8");
}

/** 读取并校验测试临时根 marker；非法磁盘数据返回 null。 */
export async function readTmpMarker(root: string): Promise<TestTmpRootMarker | null> {
    const text = await readFile(resolve(root, TMP_MARKER_FILE), "utf8").catch(() => null);
    if (text === null) return null;
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Partial<Record<keyof TestTmpRootMarker, unknown>>;
    if (typeof candidate.schemaVersion !== "number"
        || typeof candidate.createdAt !== "string"
        || typeof candidate.pid !== "number"
        || typeof candidate.runId !== "string"
        || typeof candidate.purpose !== "string") return null;
    return {
        schemaVersion: candidate.schemaVersion,
        createdAt: candidate.createdAt,
        pid: candidate.pid,
        runId: candidate.runId,
        purpose: candidate.purpose,
    };
}

/** 写入 fixture owner marker。 */
export async function writeFixtureMarker(root: string, marker: TestWorkspaceFixtureMarker): Promise<void> {
    await writeFile(resolve(root, FIXTURE_MARKER_FILE), `${JSON.stringify(marker, null, 4)}\n`, "utf8");
}

/** 读取并校验 fixture owner marker；非法磁盘数据返回 null。 */
export async function readFixtureMarker(root: string): Promise<TestWorkspaceFixtureMarker | null> {
    const text = await readFile(resolve(root, FIXTURE_MARKER_FILE), "utf8").catch(() => null);
    if (text === null) return null;
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Partial<Record<keyof TestWorkspaceFixtureMarker, unknown>>;
    if (typeof candidate.schemaVersion !== "number"
        || typeof candidate.createdAt !== "string"
        || typeof candidate.pid !== "number"
        || typeof candidate.runId !== "string"
        || typeof candidate.purpose !== "string"
        || (candidate.systemAssets !== "shared" && candidate.systemAssets !== "isolated")) return null;
    return {
        schemaVersion: candidate.schemaVersion,
        createdAt: candidate.createdAt,
        pid: candidate.pid,
        runId: candidate.runId,
        purpose: candidate.purpose,
        systemAssets: candidate.systemAssets,
    };
}

/**
 * 删除 fixture root。
 *
 * root 下可能含指向仓库本体的 junction；只删除链接本身，不跟随进入目标。
 */
export async function removeFixtureTree(root: string): Promise<void> {
    const entries = await readdir(root, {withFileTypes: true}).catch(() => []);
    const failures: unknown[] = [];
    for (const entry of entries) {
        if (entry.name === FIXTURE_MARKER_FILE || entry.name === TMP_MARKER_FILE) continue;
        const target = resolve(root, entry.name);
        try {
            const stats = await lstat(target);
            await rm(target, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
            if (stats.isSymbolicLink()) continue;
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length > 0) throw new AggregateError(failures, `fixture root 清理存在失败项：${root}`);

    const markerNames = [FIXTURE_MARKER_FILE, TMP_MARKER_FILE];
    const markerTexts = new Map<string, string | null>();
    for (const name of markerNames) {
        markerTexts.set(name, await readFile(resolve(root, name), "utf8").catch(() => null));
        await rm(resolve(root, name), {force: true, maxRetries: 10, retryDelay: 100});
    }
    try {
        await rmdir(root);
    } catch (error) {
        const restoreFailures: unknown[] = [error];
        for (const [name, text] of markerTexts) {
            if (text !== null) {
                try {
                    await writeFile(resolve(root, name), text, "utf8");
                } catch (restoreError) {
                    restoreFailures.push(restoreError);
                }
            }
        }
        throw new AggregateError(restoreFailures, `fixture root 清理存在失败项：${root}`);
    }
}
export {isProcessAlive, TEST_RUN_ID_ENV} from "./process";
