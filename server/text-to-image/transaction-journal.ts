import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * 角色视觉库统一事务日志：四类事务（分组迁移、视觉移动、身份同步、触发词迁移）
 * 共用 `.nbook/text-to-image/.txn/` 目录，日志一律使用带 `kind` 的 envelope。
 * 业务恢复器只消费 dispatcher 分派的单条日志，不自行扫描全部日志。
 */

export const VISUAL_LIBRARY_DIRECTORY = path.join(".nbook", "text-to-image");
export const TRANSACTION_DIRECTORY = ".txn";
export const TRANSACTION_LOCK_FILE = ".migration.lock";

export const TRANSACTION_KINDS = [
    "group-migration-v1",
    "visual-move-v1",
    "identity-v1",
    "trigger-words-v1",
] as const;
export type TransactionJournalKind = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_JOURNAL_VERSION = 1;

export type TransactionJournalEnvelope = {
    kind: TransactionJournalKind;
    version: typeof TRANSACTION_JOURNAL_VERSION;
    transactionId: string;
    state: string;
    createdAt: string;
    payload: Record<string, unknown>;
};

export type TransactionJournalIssue = {
    entry: string;
    reason: "corrupt" | "invalid-envelope" | "unknown-kind" | "unknown-version";
};

export type TransactionRecoveryReport = {
    finalized: string[];
    recovered: string[];
    skippedActive: string[];
    kept: TransactionJournalIssue[];
};

export type TransactionRecoveryHandlers = Partial<Record<
    TransactionJournalKind,
    (projectRoot: string, envelope: TransactionJournalEnvelope) => Promise<void>
>>;

export function transactionJournalRoot(projectRoot: string): string {
    return path.join(projectRoot, VISUAL_LIBRARY_DIRECTORY, TRANSACTION_DIRECTORY);
}

export function transactionJournalPath(projectRoot: string, transactionId: string): string {
    return path.join(transactionJournalRoot(projectRoot), `${transactionId}.json`);
}

export async function writeTransactionJournal(
    projectRoot: string,
    envelope: TransactionJournalEnvelope,
): Promise<void> {
    await writeJsonAtomic(transactionJournalPath(projectRoot, envelope.transactionId), envelope);
}

export async function removeTransactionJournal(projectRoot: string, transactionId: string): Promise<void> {
    await fs.rm(transactionJournalPath(projectRoot, transactionId), {force: true});
}

/**
 * 扫描一次 `.txn` 并校验 envelope，按 kind 分派给对应业务恢复器。
 * - `committed` 状态的日志只做收尾清理，无论新旧；
 * - 其它状态只在日志年龄超过 activeWindowMs 时才回滚，仍在活跃窗口内的日志保留
 *   给持有 Project 锁的进行中事务，避免并发误回滚；
 * - 损坏日志、未知 kind、未知版本一律报告并保留，不得删除。
 */
export async function recoverUnfinishedTransactions(
    projectRoot: string,
    handlers: TransactionRecoveryHandlers,
    options: {activeWindowMs?: number; now?: () => number} = {},
): Promise<TransactionRecoveryReport> {
    const root = transactionJournalRoot(projectRoot);
    let entries: string[];
    try {
        entries = await fs.readdir(root);
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) {
            return {finalized: [], recovered: [], skippedActive: [], kept: []};
        }
        throw error;
    }
    const activeWindowMs = options.activeWindowMs ?? 5 * 60_000;
    const now = (options.now ?? Date.now)();
    const report: TransactionRecoveryReport = {finalized: [], recovered: [], skippedActive: [], kept: []};
    for (const entry of entries.sort()) {
        if (!entry.endsWith(".json")) continue;
        const journalPath = path.join(root, entry);
        let raw: unknown;
        try {
            raw = JSON.parse(await fs.readFile(journalPath, "utf8"));
        } catch {
            report.kept.push({entry, reason: "corrupt"});
            continue;
        }
        const validation = validateTransactionEnvelope(raw);
        if (validation !== "ok") {
            report.kept.push({entry, reason: validation});
            continue;
        }
        const envelope = raw as TransactionJournalEnvelope;
        const handler = handlers[envelope.kind];
        if (!handler) {
            report.kept.push({entry, reason: "unknown-kind"});
            continue;
        }
        if (envelope.state === "committed") {
            await handler(projectRoot, envelope);
            report.finalized.push(envelope.transactionId);
            continue;
        }
        const age = now - Date.parse(envelope.createdAt);
        if (Number.isFinite(age) && age < activeWindowMs) {
            report.skippedActive.push(envelope.transactionId);
            continue;
        }
        await handler(projectRoot, envelope);
        report.recovered.push(envelope.transactionId);
    }
    return report;
}

function validateTransactionEnvelope(
    value: unknown,
): "ok" | "corrupt" | "invalid-envelope" | "unknown-kind" | "unknown-version" {
    if (typeof value !== "object" || value === null) return "corrupt";
    const record = value as Record<string, unknown>;
    if (typeof record.kind !== "string" || typeof record.transactionId !== "string"
        || typeof record.state !== "string" || typeof record.createdAt !== "string") {
        return "invalid-envelope";
    }
    if (!(TRANSACTION_KINDS as readonly string[]).includes(record.kind)) return "unknown-kind";
    if (record.version !== TRANSACTION_JOURNAL_VERSION) return "unknown-version";
    if (record.transactionId === "" || record.state === "") return "invalid-envelope";
    if (typeof record.payload !== "object" || record.payload === null || Array.isArray(record.payload)) {
        return "invalid-envelope";
    }
    return "ok";
}

export function buildTransactionEnvelope(input: {
    kind: TransactionJournalKind;
    transactionId: string;
    state: string;
    createdAt?: string;
    payload: Record<string, unknown>;
}): TransactionJournalEnvelope {
    return {
        kind: input.kind,
        version: TRANSACTION_JOURNAL_VERSION,
        transactionId: input.transactionId,
        state: input.state,
        createdAt: input.createdAt ?? new Date().toISOString(),
        payload: input.payload,
    };
}

/** 新事务 ID；测试可通过 nextTransactionId 注入确定性 ID。 */
export function newTransactionId(nextTransactionId?: () => string): string {
    return (nextTransactionId ?? randomUUID)();
}

const heldLocks = new Set<string>();

/**
 * Project 级视觉库排他锁：wx 独占创建，带过期清理与有限重试；
 * 同进程可重入（同一 Project 的恢复、迁移与写入共用同一把锁）。
 */
export async function withVisualLibraryProjectLock<T>(
    projectRoot: string,
    task: () => Promise<T>,
    options: {lockTimeoutMs?: number} = {},
): Promise<T> {
    const lockPath = path.join(projectRoot, VISUAL_LIBRARY_DIRECTORY, TRANSACTION_LOCK_FILE);
    if (heldLocks.has(lockPath)) {
        return await task();
    }
    await fs.mkdir(path.dirname(lockPath), {recursive: true});
    const timeoutMs = options.lockTimeoutMs ?? 15_000;
    const startedAt = Date.now();
    let acquired = false;
    while (!acquired) {
        try {
            const handle = await fs.open(lockPath, "wx");
            await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf8");
            await handle.close();
            acquired = true;
        } catch (error) {
            if (!isErrorCode(error, "EEXIST")) throw error;
            const stat = await fs.stat(lockPath).catch(() => null);
            if (stat && Date.now() - stat.mtimeMs > 5 * 60_000) {
                await fs.rm(lockPath, {force: true});
                continue;
            }
            if (Date.now() - startedAt > timeoutMs) {
                throw new Error("角色视觉库正在执行迁移，请稍后重试");
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    heldLocks.add(lockPath);
    try {
        return await task();
    } finally {
        heldLocks.delete(lockPath);
        await fs.rm(lockPath, {force: true});
    }
}

export async function writeJsonAtomic(filePath: string, input: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
}

export function isErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
