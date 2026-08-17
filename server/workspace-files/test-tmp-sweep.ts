import type {Dirent} from "node:fs";
import {lstat, mkdir, mkdtemp, readdir, readFile, rm, rmdir, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {basename, resolve} from "node:path";
import {resolveAgentTempRoot} from "nbook/scripts/utils/agent-paths";
import {isProcessAlive, TEST_RUN_ID_ENV} from "nbook/server/workspace-files/test-workspace-fixture";

/**
 * 测试临时根的兜底清理（系统 Temp 下的 Agent 根）。
 *
 * 测试临时目录统一放 `<os.tmpdir>/neuro-book/agent/<name>-<uuid>/`，由 Vitest
 * globalSetup 在每次 run 起点 sweep 上一次 run 的残留。正常路径由各测试自己清理，
 * 这里只负责被强杀/中断后无法走到清理代码的残留。
 */
export const TMP_ROOT_REL = "agent";
/** owner marker 文件名。 */
export const TMP_MARKER_FILE = ".nbook-tmp.json";
/** marker 结构版本；sweep 只回收版本一致的 root。 */
export const TMP_MARKER_SCHEMA_VERSION = 1;
/** 保守回收窗口：合法 marker 超过该时长且 owner 已退出才允许回收。 */
export const TMP_STALE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 测试临时根目录的 owner marker。 */
export type TestTmpRootMarker = {
    /** marker 结构版本；不一致一律保留并报告，不回收。 */
    schemaVersion: number;
    /** 创建时刻 ISO 字符串；用于保守回收窗口判定。 */
    createdAt: string;
    /** 创建进程 PID；仍存活时绝不回收。 */
    pid: number;
    /** 单次 Vitest run 标识；用于把同一 run 的 root 归组诊断。 */
    runId: string;
    /** 用途标签，仅用于诊断。 */
    purpose: string;
};

/** sweep 判定保留某个 root 的原因。 */
export type TmpSweepRetainReason = "no_marker" | "schema_mismatch" | "owner_alive" | "within_window" | "unreadable";

export type TmpSweepReport = {
    /** 已成功回收的 root 绝对路径。 */
    removed: string[];
    /** 无法证明可安全回收的 root 及原因。 */
    retained: {root: string; reason: TmpSweepRetainReason}[];
    /** 回收过程中的失败项；不阻断本次 run。 */
    failures: {root: string; message: string}[];
};
/** 解析系统 Temp 下 Agent 测试临时根的绝对路径。 */
export function resolveTmpRoot(): string {
    return resolve(resolveAgentTempRoot(), TMP_ROOT_REL);
}

/**
 * 新建测试临时根（新测试的推荐入口）：在系统 Temp Agent 根下 `mkdtemp`
 * 并写 owner marker。
 */
export async function createTestTmpRoot(name: string, purpose?: string): Promise<string> {
    const tmpRoot = resolveTmpRoot();
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

/**
 * 回收上一次运行留下的测试临时 root。
 *
 * 安全优先：只有真实目录、可读且版本匹配的 marker、超窗、owner 已退出，才允许回收。
 * 没有 marker 或 marker 无法读取时保留并报告；不能用目录名或 mtime 单独推断所有权。
 */
export async function sweepStaleTmpRoots(parentRoot: string = resolveTmpRoot(), now: number = Date.now()): Promise<TmpSweepReport> {
    const report: TmpSweepReport = {removed: [], retained: [], failures: []};
    const parentStats = await lstat(parentRoot).catch(() => null);
    if (!parentStats || parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
        report.retained.push({root: parentRoot, reason: "unreadable"});
        return report;
    }
    let entries: Dirent[];
    try {
        entries = await readdir(parentRoot, {withFileTypes: true});
    } catch (error) {
        report.failures.push({root: parentRoot, message: error instanceof Error ? error.message : String(error)});
        return report;
    }
    for (const entry of entries) {
        const root = resolve(parentRoot, entry.name);
        const stats = await lstat(root).catch(() => null);
        if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
            report.retained.push({root, reason: "unreadable"});
            continue;
        }
        const markerPath = resolve(root, TMP_MARKER_FILE);
        const markerStats = await lstat(markerPath).catch(() => null);
        if (!markerStats) {
            report.retained.push({root, reason: "no_marker"});
            continue;
        }
        if (markerStats.isSymbolicLink() || !markerStats.isFile()) {
            report.retained.push({root, reason: "unreadable"});
            continue;
        }
        const marker = await readTmpMarker(root);
        if (marker === null) {
            report.retained.push({root, reason: "unreadable"});
            continue;
        }
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
        try {
            await removeMarkedTmpRoot(root, markerPath);
            report.removed.push(root);
        } catch (error) {
            report.failures.push({root, message: error instanceof Error ? error.message : String(error)});
        }
    }
    return report;
}

/** 写入 owner marker；marker 是受控 root 能被 sweep 回收的必要证据。 */
export async function writeTmpMarker(root: string, marker: TestTmpRootMarker): Promise<void> {
    await writeFile(resolve(root, TMP_MARKER_FILE), `${JSON.stringify(marker, null, 4)}\n`, "utf8");
}

/**
 * 删除带 marker 的 root。marker 最后删除；任何失败都保留 marker，避免下次 sweep 误判所有权。
 * 该 helper 只供 Vitest run teardown 使用，不接受未知目录的递归强删。
 */
export async function removeMarkedTmpRoot(root: string, markerFile: string): Promise<void> {
    const rootPath = resolve(root);
    const markerPath = resolve(markerFile);
    if (markerPath !== resolve(rootPath, basename(markerPath))) throw new Error(`marker 不在 root 直接子项内：${rootPath}`);
    const rootStats = await lstat(rootPath);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error(`run root 不是可安全删除的真实目录：${rootPath}`);
    const markerStats = await lstat(markerPath);
    if (markerStats.isSymbolicLink() || !markerStats.isFile()) throw new Error(`run root marker 不是普通文件：${markerPath}`);
    const markerText = await readFile(markerPath, "utf8");
    const failures: unknown[] = [];
    const entries = await readdir(rootPath, {withFileTypes: true});
    for (const entry of entries) {
        if (entry.name === basename(markerPath)) continue;
        const target = resolve(rootPath, entry.name);
        try {
            await lstat(target);
            await rm(target, {recursive: true, force: false, maxRetries: 10, retryDelay: 100});
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length > 0) throw new AggregateError(failures, `Vitest run root 清理存在失败项：${rootPath}`);
    const finalRootStats = await lstat(rootPath);
    if (finalRootStats.isSymbolicLink() || !finalRootStats.isDirectory()) throw new Error(`run root 在清理时变为非真实目录：${rootPath}`);
    await rm(markerPath, {force: false});
    try {
        await rmdir(rootPath);
    } catch (error) {
        await writeFile(markerPath, markerText, "utf8").catch((restoreError: unknown) => {
            throw new AggregateError([error, restoreError], `run root 清理失败且无法恢复 marker：${rootPath}`);
        });
        throw new AggregateError([error], `Vitest run root 清理失败：${rootPath}`);
    }
}

/** 读取并逐字段窄化 owner marker；任何字段不合法都返回 null，交由调用方保留目录。 */
async function readTmpMarker(root: string): Promise<TestTmpRootMarker | null> {
    const text = await readFile(resolve(root, TMP_MARKER_FILE), "utf8").catch(() => null);
    if (text === null) {
        return null;
    }
    let value: unknown;
    try {
        // marker 是磁盘上的外部数据，解析前形态未知，这里是 unknown 的正当用法。
        value = JSON.parse(text) as unknown;
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const candidate = value as Partial<Record<keyof TestTmpRootMarker, unknown>>;
    if (typeof candidate.schemaVersion !== "number"
        || typeof candidate.createdAt !== "string"
        || typeof candidate.pid !== "number"
        || typeof candidate.runId !== "string"
        || typeof candidate.purpose !== "string") {
        return null;
    }
    return {
        schemaVersion: candidate.schemaVersion,
        createdAt: candidate.createdAt,
        pid: candidate.pid,
        runId: candidate.runId,
        purpose: candidate.purpose,
    };
}
