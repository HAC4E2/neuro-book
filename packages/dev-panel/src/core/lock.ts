import {lstat, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {lock} from "proper-lockfile";
import {NbdevError, systemErrorCode, type Warning} from "./errors.js";
import {AGENT_LOCAL_ROOT, REGISTRY_FILE} from "./registry.js";
import {WORKS_ROOT} from "./repo.js";

/** 锁目录 10 秒没有心跳就可被接管；心跳每 2 秒一次。 */
const LOCK_STALE_MS = 10_000;
const LOCK_UPDATE_MS = 2_000;
/** 等锁的预算要明显大于持锁者等 index.lock 的 10 秒加一次事务的耗时，否则持锁者一遇到 index.lock，所有等待者都会超时。 */
export const DEFAULT_LOCK_WAIT_MS = 30_000;

export type LockHolder = {pid: number; startedAt: string; command: string; cwd: string; alive: boolean};

export type RecordsLock = {
    /** 锁被抢走（心跳报告或锁目录已不是取到的那一个）时抛 `lock_compromised`。 */
    assertHealthy(stage: string): Promise<void>;
    /** 放锁；失败时返回一条警告而不是抛错，调用方已完成的工作不受影响。 */
    release(): Promise<Warning | null>;
};

export function agentPaths(mainRoot: string) {
    const agentRoot = resolve(mainRoot, AGENT_LOCAL_ROOT);
    return {
        agentRoot,
        registryFile: resolve(mainRoot, REGISTRY_FILE),
        lockDir: resolve(mainRoot, `${REGISTRY_FILE}.lock`),
        ownerFile: resolve(agentRoot, "run", "lock-owner.json"),
        tmpRoot: resolve(agentRoot, "run", "tmp"),
    };
}

/**
 * 建好 `.local/agent/run/tmp`，并确认它与 `.agents/works` 在同一个文件系统上：
 * 新目录靠 `rename` 原子落位；`.local/` 属于用户区，可能被换成指向别的盘的符号链接。
 */
export async function prepareAgentDirectories(mainRoot: string): Promise<void> {
    const {tmpRoot} = agentPaths(mainRoot);
    await mkdir(tmpRoot, {recursive: true});
    const [tmpStats, worksStats] = await Promise.all([stat(tmpRoot), stat(resolve(mainRoot, WORKS_ROOT))]);
    if (tmpStats.dev !== worksStats.dev) {
        throw new NbdevError("cross_device", `${AGENT_LOCAL_ROOT}/run/tmp 与 ${WORKS_ROOT} 不在同一个文件系统上，无法原子地落位新记录`, {
            details: {tmpRoot, worksRoot: resolve(mainRoot, WORKS_ROOT)},
        });
    }
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (systemErrorCode(error) === "EPERM") return true;
        if (systemErrorCode(error) === "ESRCH") return false;
        throw error;
    }
}

/** 读持锁者信息，只用于超时时的诊断：文件不存在为 null；持锁者正在写或写到一半崩溃时，带上读不出的原因。 */
async function readHolder(ownerFile: string): Promise<{holder: LockHolder | null; problem: string | null}> {
    let text: string;
    try {
        text = await readFile(ownerFile, "utf8");
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return {holder: null, problem: null};
        throw error;
    }
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        return {holder: null, problem: `lock-owner.json 无法解析：${error instanceof Error ? error.message : String(error)}`};
    }
    if (!value || typeof value !== "object" || typeof (value as {pid?: unknown}).pid !== "number") {
        return {holder: null, problem: "lock-owner.json 缺少 pid"};
    }
    const owner = value as {pid: number; startedAt?: unknown; command?: unknown; cwd?: unknown};
    return {
        holder: {
            pid: owner.pid,
            startedAt: typeof owner.startedAt === "string" ? owner.startedAt : "",
            command: typeof owner.command === "string" ? owner.command : "",
            cwd: typeof owner.cwd === "string" ? owner.cwd : "",
            alive: isAlive(owner.pid),
        },
        problem: null,
    };
}

type LockIdentity = {ino: number; birthtimeMs: number};

async function lockIdentity(lockDir: string): Promise<LockIdentity | null> {
    try {
        const stats = await lstat(lockDir);
        return {ino: stats.ino, birthtimeMs: stats.birthtimeMs};
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return null;
        throw error;
    }
}

/**
 * 取主工作区的记录锁（`.local/agent/registry.json.lock`，proper-lockfile 的目录锁）。
 * 只按错误码 ELOCKED 判断被占，自己随机退避重试到 `waitMs`。
 * proper-lockfile 接管过期锁是“判定过期、rmdir、mkdir”三步，不是原子的；所以记下锁目录的 inode 与 birthtime，
 * 在关键步骤前比对，发现锁目录已被别人重建就停下。
 */
export async function acquireRecordsLock(mainRoot: string, waitMs: number = DEFAULT_LOCK_WAIT_MS): Promise<RecordsLock> {
    const paths = agentPaths(mainRoot);
    const startedAt = Date.now();
    let compromisedBy: Error | null = null;
    let releaseLock: () => Promise<void>;
    for (;;) {
        try {
            releaseLock = await lock(paths.registryFile, {
                lockfilePath: paths.lockDir,
                realpath: false,
                stale: LOCK_STALE_MS,
                update: LOCK_UPDATE_MS,
                retries: 0,
                onCompromised: (error) => {
                    compromisedBy = error;
                },
            });
            break;
        } catch (error) {
            if (systemErrorCode(error) !== "ELOCKED") {
                throw new NbdevError("lock_failed", `取记录锁失败：${error instanceof Error ? error.message : String(error)}`, {cause: error, details: {lockDir: paths.lockDir}});
            }
            if (Date.now() - startedAt >= waitMs) {
                const {holder, problem} = await readHolder(paths.ownerFile);
                throw new NbdevError("lock_timeout", `等记录锁超过 ${Math.round(waitMs / 1000)} 秒，持锁者：${holder ? `pid ${holder.pid}（${holder.alive ? "在运行" : "已退出"}）` : problem ?? "未知"}`, {
                    details: {lockDir: paths.lockDir, waitedMs: Date.now() - startedAt, holder, holderProblem: problem},
                });
            }
            await sleep(50 + Math.floor(Math.random() * 200));
        }
    }
    let identity: LockIdentity | null;
    try {
        identity = await lockIdentity(paths.lockDir);
        await writeFile(paths.ownerFile, `${JSON.stringify({pid: process.pid, startedAt: new Date(startedAt).toISOString(), command: process.argv.join(" "), cwd: process.cwd()}, null, 4)}\n`, "utf8");
    } catch (error) {
        await releaseLock();
        throw new NbdevError("lock_failed", `记录持锁者信息失败：${error instanceof Error ? error.message : String(error)}`, {cause: error, details: {ownerFile: paths.ownerFile}});
    }
    return {
        async assertHealthy(stage) {
            if (compromisedBy) {
                throw new NbdevError("lock_compromised", `记录锁在${stage}之前被抢走：${(compromisedBy as Error).message}`, {cause: compromisedBy, details: {stage}});
            }
            const current = await lockIdentity(paths.lockDir);
            if (!identity || !current || current.ino !== identity.ino || current.birthtimeMs !== identity.birthtimeMs) {
                throw new NbdevError("lock_compromised", `记录锁在${stage}之前被别的进程重建`, {details: {stage, expected: identity, current}});
            }
        },
        async release() {
            try {
                await rm(paths.ownerFile, {force: true});
                await releaseLock();
                return null;
            } catch (error) {
                return {code: "lock_release_failed", message: `放记录锁失败：${error instanceof Error ? error.message : String(error)}`, details: {lockDir: paths.lockDir}};
            }
        },
    };
}
