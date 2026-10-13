import {createHash, randomBytes} from "node:crypto";
import {lstat, mkdir, readdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {NbdevError, systemErrorCode, type Warning} from "./errors.js";
import type {ProcessRef, SessionCaller, SessionRef} from "./identity.js";
import {TASK_ID_PATTERN, WORK_ID_PATTERN} from "./ids.js";
import {isIsoTime, isNullableString, isRecord} from "./json.js";
import {processAlive} from "./procfs.js";
import type {TaskStatus} from "./records.js";
import {AGENT_LOCAL_ROOT} from "./registry.js";

/**
 * 租约：某个会话正在某个 Task 上做事的临时事实，存在主工作区的 `.local/agent/run/leases/`，不入库。
 * 租约文件不进写事务的锁：有效性在读取时现算（Task 已关闭、会话进程已不在都直接判无效），
 * 所以并发的取得与释放互相覆盖，最坏只丢一次 `lastActivityAt` 更新，不会让已关闭的 Task 重新有人“在动”。
 */
export const LEASE_SCHEMA = "nbdev.lease/v1";
export const LEASES_DIR = `${AGENT_LOCAL_ROOT}/run/leases`;
export const LEASE_EXPIRY_MS = 24 * 3_600_000;
export const LEASE_STALE_MS = 2 * 3_600_000;
const LEASE_FILE_PATTERN = /^[0-9a-f]{24}\.json$/u;
const LEASE_TEMPORARY_PATTERN = /^[0-9a-f]{24}\.json\.tmp-/u;
const LEASE_ID_PATTERN = /^[0-9a-f]{24}$/u;
const RELEASE_REASONS: readonly string[] = ["released", "task_done", "task_shelved"];
const READ_BATCH = 64;

export type LeaseHerdr = {socketPath: string; paneId: string; terminalId: string};
export type LeaseSession = SessionRef & {process: ProcessRef | null; herdr: LeaseHerdr | null};
export type ReleaseReason = "released" | "task_done" | "task_shelved";
export type LeaseRecord = {
    schema: typeof LEASE_SCHEMA;
    leaseId: string;
    workId: string;
    taskId: string;
    session: LeaseSession;
    acquiredAt: string;
    lastActivityAt: string;
    lastAction: string;
    releasedAt: string | null;
    releaseReason: ReleaseReason | null;
};

export type LeaseState = "valid" | "released" | "task_closed" | "expired" | "session_gone" | "superseded";
export type EvaluatedLease = LeaseRecord & {state: LeaseState; stale: boolean; managed: boolean};

/** 现算有效性要用的外部事实，调用方先查好：Task 的当前状态、会话进程是否还在、本次能看到的 herdr。 */
export type LeaseContext = {
    now: Date;
    taskStatus(workId: string, taskId: string): TaskStatus | null;
    processAlive(process: ProcessRef): boolean;
    /** 本次评估用的 herdr：socket 与它列表里的会话 id；herdr 不可用时为 null。 */
    herdr: {socketPath: string; sessionIds: ReadonlySet<string>} | null;
};

export type LeaseSelector = {kind: "task"; workId: string; taskId: string} | {kind: "session"; sessionKey: string; workId?: string; taskId?: string};

export function leaseId(sessionKey: string, workId: string, taskId: string): string {
    return createHash("sha256").update(`${sessionKey}\n${workId}/${taskId}`).digest("hex").slice(0, 24);
}

function leasePath(mainRoot: string, id: string): string {
    return resolve(mainRoot, LEASES_DIR, `${id}.json`);
}

function processKey(process: ProcessRef): string {
    return `${process.pid}:${process.startTicks}`;
}

function sameProcess(left: ProcessRef | null, right: ProcessRef | null): boolean {
    return left === null || right === null ? left === right : processKey(left) === processKey(right);
}

function parseProcess(value: unknown): ProcessRef | null | undefined {
    if (value === null) return null;
    if (!isRecord(value) || !Number.isInteger(value.pid) || (value.pid as number) <= 0 || typeof value.startTicks !== "string" || !/^[0-9]+$/u.test(value.startTicks)) return undefined;
    return {pid: value.pid as number, startTicks: value.startTicks};
}

function parseLeaseHerdr(value: unknown): LeaseHerdr | null | undefined {
    if (value === null) return null;
    if (!isRecord(value) || typeof value.socketPath !== "string" || typeof value.paneId !== "string" || typeof value.terminalId !== "string") return undefined;
    return {socketPath: value.socketPath, paneId: value.paneId, terminalId: value.terminalId};
}

/** 校验并重建租约里的会话快照；不合规时返回原因。provenance 记的也是这份快照。 */
export function parseLeaseSession(value: unknown): LeaseSession | string {
    if (!isRecord(value)) return "session 不是对象";
    if (typeof value.key !== "string" || value.key === "" || typeof value.agent !== "string") return "session.key 或 session.agent 不是非空字符串";
    if (!isNullableString(value.sessionId) || !isNullableString(value.label) || !isNullableString(value.parentSessionId)) return "session 的 sessionId、label、parentSessionId 只能是字符串或 null";
    // nestedSessionId 是后加的字段：没有这个键的旧文件按 null 读。
    const nestedSessionId = value.nestedSessionId === undefined ? null : value.nestedSessionId;
    if (!isNullableString(nestedSessionId)) return "session.nestedSessionId 只能是字符串或 null";
    const process = parseProcess(value.process);
    if (process === undefined) return "session.process 只能是 {pid: 正整数, startTicks: 数字串} 或 null";
    const herdr = parseLeaseHerdr(value.herdr);
    if (herdr === undefined) return "session.herdr 只能是 {socketPath, paneId, terminalId} 三个字符串或 null";
    return {key: value.key, agent: value.agent, sessionId: value.sessionId, label: value.label, parentSessionId: value.parentSessionId, nestedSessionId, process, herdr};
}

/**
 * 逐字段校验后重建记录：租约文件在 `.local/agent/` 下，谁都能改，类型声明代替不了运行期检查。
 * `leaseId` 必须与文件名一致：释放时按它拼回写路径。
 */
function parseLease(text: string, expectedId: string): {lease: LeaseRecord} | {problem: string} {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        return {problem: `不是合法 JSON：${error instanceof Error ? error.message : String(error)}`};
    }
    if (!isRecord(value) || value.schema !== LEASE_SCHEMA) return {problem: "schema 不是 nbdev.lease/v1"};
    if (typeof value.leaseId !== "string" || !LEASE_ID_PATTERN.test(value.leaseId) || value.leaseId !== expectedId) return {problem: "leaseId 不是 24 位 hex，或与文件名不一致"};
    if (typeof value.workId !== "string" || !WORK_ID_PATTERN.test(value.workId) || typeof value.taskId !== "string" || !TASK_ID_PATTERN.test(value.taskId)) {
        return {problem: "workId 或 taskId 不合编号格式"};
    }
    const session = parseLeaseSession(value.session);
    if (typeof session === "string") return {problem: session};
    if (!isIsoTime(value.acquiredAt) || !isIsoTime(value.lastActivityAt) || (value.releasedAt !== null && !isIsoTime(value.releasedAt))) {
        return {problem: "acquiredAt、lastActivityAt、releasedAt 不是合法的 ISO 时间"};
    }
    if (typeof value.lastAction !== "string") return {problem: "lastAction 不是字符串"};
    const releaseReason = value.releaseReason;
    if (releaseReason !== null && (typeof releaseReason !== "string" || !RELEASE_REASONS.includes(releaseReason))) return {problem: `releaseReason 只能是 ${RELEASE_REASONS.join("、")} 或 null`};
    if ((value.releasedAt === null) !== (releaseReason === null)) return {problem: "releasedAt 与 releaseReason 要么都有、要么都是 null"};
    return {
        lease: {
            schema: LEASE_SCHEMA,
            leaseId: value.leaseId,
            workId: value.workId,
            taskId: value.taskId,
            session,
            acquiredAt: value.acquiredAt,
            lastActivityAt: value.lastActivityAt,
            lastAction: value.lastAction,
            releasedAt: value.releasedAt as string | null,
            releaseReason: releaseReason as ReleaseReason | null,
        },
    };
}

/**
 * 读租约；只认 `<24 位 hex>.json`（别人写到一半的临时文件不读）。租约是运行时数据，读不出（内容不合规、权限不够、
 * 目录本身读不了）一律给 `unreadable_lease` 警告后跳过：一个坏文件不能让 `status` 或记录操作失败。
 * 文件只增不删：缺省跳过修改时间早于 24 小时之前的文件（每次续期、释放都会重写文件，这样的租约必然已过期或已释放），
 * `all` 时才全读（`lease list --all`）。
 */
export async function readLeases(mainRoot: string, options: {all?: boolean} = {}): Promise<{leases: LeaseRecord[]; warnings: Warning[]}> {
    const dir = resolve(mainRoot, LEASES_DIR);
    let names: string[];
    try {
        names = await readdir(dir);
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return {leases: [], warnings: []};
        if (systemErrorCode(error) === undefined) throw error;
        return {leases: [], warnings: [{code: "unreadable_lease", message: `租约目录读不了，按没有租约处理：${LEASES_DIR}（${systemErrorCode(error)}）`, details: {path: LEASES_DIR, code: systemErrorCode(error)}}]};
    }
    const cutoff = Date.now() - LEASE_EXPIRY_MS;
    const readOne = async (name: string): Promise<{lease: LeaseRecord} | {warning: Warning} | null> => {
        let text: string;
        try {
            if (!options.all && (await lstat(join(dir, name))).mtimeMs < cutoff) return null;
            text = await readFile(join(dir, name), "utf8");
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") return null;
            if (systemErrorCode(error) === undefined) throw error;
            return {warning: {code: "unreadable_lease", message: `租约文件读不了，已跳过：${name}（${systemErrorCode(error)}）`, details: {path: join(LEASES_DIR, name), code: systemErrorCode(error)}}};
        }
        const parsed = parseLease(text, name.slice(0, -".json".length));
        if ("lease" in parsed) return {lease: parsed.lease};
        return {warning: {code: "unreadable_lease", message: `租约文件读不出，已跳过：${name}（${parsed.problem}）`, details: {path: join(LEASES_DIR, name), problem: parsed.problem}}};
    };
    const leases: LeaseRecord[] = [];
    const warnings: Warning[] = [];
    const candidates = names.filter((candidate) => LEASE_FILE_PATTERN.test(candidate)).sort();
    // 分批并发：一次全发出去，文件多时会撞上打开文件数的上限（EMFILE）。
    for (let start = 0; start < candidates.length; start += READ_BATCH) {
        for (const outcome of await Promise.all(candidates.slice(start, start + READ_BATCH).map(readOne))) {
            if (outcome && "lease" in outcome) leases.push(outcome.lease);
            else if (outcome) warnings.push(outcome.warning);
        }
    }
    return {leases, warnings};
}

/** 读一份租约；文件不存在为 null，读不出（内容不合规或权限不够）时抛 `invalid_record`（`touchLease` 会接住并整份重写）。 */
export async function getLease(mainRoot: string, id: string): Promise<LeaseRecord | null> {
    if (!LEASE_ID_PATTERN.test(id)) throw new NbdevError("invalid_record", `租约 id 不是 24 位 hex：${id}`, {details: {leaseId: id}});
    let text: string;
    try {
        text = await readFile(leasePath(mainRoot, id), "utf8");
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return null;
        if (systemErrorCode(error) === undefined) throw error;
        throw new NbdevError("invalid_record", `租约文件读不了：${id}（${systemErrorCode(error)}）`, {cause: error, details: {leaseId: id, code: systemErrorCode(error)}});
    }
    const parsed = parseLease(text, id);
    if ("problem" in parsed) throw new NbdevError("invalid_record", `租约文件读不出：${id}（${parsed.problem}）`, {details: {leaseId: id, problem: parsed.problem}});
    return parsed.lease;
}

async function writeLease(mainRoot: string, lease: LeaseRecord): Promise<void> {
    const path = leasePath(mainRoot, lease.leaseId);
    const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    try {
        await mkdir(resolve(mainRoot, LEASES_DIR), {recursive: true});
        await writeFile(temporary, `${JSON.stringify(lease, null, 4)}\n`, {encoding: "utf8", flag: "wx"});
        await rename(temporary, path);
    } catch (error) {
        await rm(temporary, {force: true});
        throw new NbdevError("write_failed", `写租约失败：${path}`, {cause: error, details: {path}});
    }
}

/**
 * 取得或续期：每次都用本次解析出的调用者重写整个会话快照（进程、herdr 位置、标签）。
 * `claude --resume` 沿用会话 id 但换了进程；旧记录已释放、超过 24 小时、进程变了或旧进程已不在时，按重新取得处理。
 */
export async function touchLease(mainRoot: string, input: {caller: SessionCaller; workId: string; taskId: string; action: string; now: Date}): Promise<LeaseRecord> {
    const {caller, workId, taskId, now} = input;
    const id = leaseId(caller.ref.key, workId, taskId);
    let existing: LeaseRecord | null;
    try {
        existing = await getLease(mainRoot, id);
    } catch (error) {
        // 读不出的旧租约按“没有”处理，下面整份重写；只有这一种错误可以这样接住。
        if (!(error instanceof NbdevError) || error.code !== "invalid_record") throw error;
        existing = null;
    }
    const session: LeaseSession = {
        ...caller.ref,
        process: caller.process,
        herdr: caller.herdr ? {socketPath: caller.herdr.socketPath, paneId: caller.herdr.paneId, terminalId: caller.herdr.terminalId} : null,
    };
    const reacquire = existing === null
        || existing.releasedAt !== null
        || now.getTime() - Date.parse(existing.lastActivityAt) > LEASE_EXPIRY_MS
        || !sameProcess(existing.session.process, session.process)
        || (existing.session.process !== null && !await processAlive(existing.session.process));
    const lease: LeaseRecord = {
        schema: LEASE_SCHEMA,
        leaseId: id,
        workId,
        taskId,
        session,
        acquiredAt: reacquire ? now.toISOString() : existing!.acquiredAt,
        lastActivityAt: now.toISOString(),
        lastAction: input.action,
        releasedAt: null,
        releaseReason: null,
    };
    await writeLease(mainRoot, lease);
    return lease;
}

/** 删掉 24 小时前崩溃留下的临时文件（`<leaseId>.json.tmp-<pid>-<随机>`）。由续期顺手调用，读取命令不调（它们不写任何文件）。 */
export async function sweepLeaseTemporaries(mainRoot: string): Promise<void> {
    const dir = resolve(mainRoot, LEASES_DIR);
    const cutoff = Date.now() - LEASE_EXPIRY_MS;
    for (const name of (await readdir(dir)).filter((candidate) => LEASE_TEMPORARY_PATTERN.test(candidate))) {
        try {
            if ((await lstat(join(dir, name))).mtimeMs < cutoff) await rm(join(dir, name), {force: true});
        } catch (error) {
            // 别的进程刚好删掉或改名了它：不影响本次续期。
            if (systemErrorCode(error) !== "ENOENT") throw error;
        }
    }
}

function matches(lease: LeaseRecord, selector: LeaseSelector): boolean {
    if (selector.kind === "task") return lease.workId === selector.workId && lease.taskId === selector.taskId;
    return lease.session.key === selector.sessionKey
        && (selector.workId === undefined || lease.workId === selector.workId)
        && (selector.taskId === undefined || lease.taskId === selector.taskId);
}

/**
 * 释放：只是给文件记上释放时间与原因，文件不删。返回这次释放了的租约；某一份写不进去时给 `lease_write_failed` 警告、接着释放其余的。
 * `notAfter`：只释放最近活动不晚于这个时刻的租约（按 Task 释放时用，见 `releaseTaskLeases`）。每份在写之前重读一次，
 * 把“读列表”与“写回”之间别人续期的那份留下；重读与改名之间仍有毫秒级的窗口。
 */
export async function releaseLeases(mainRoot: string, selector: LeaseSelector, reason: ReleaseReason, now: Date, options: {notAfter?: Date} = {}): Promise<{released: LeaseRecord[]; warnings: Warning[]}> {
    const {leases, warnings} = await readLeases(mainRoot);
    const released: LeaseRecord[] = [];
    const releasable = (lease: LeaseRecord) => lease.releasedAt === null && matches(lease, selector)
        && (options.notAfter === undefined || Date.parse(lease.lastActivityAt) <= options.notAfter.getTime());
    for (const listed of leases.filter(releasable)) {
        let lease: LeaseRecord | null;
        try {
            lease = await getLease(mainRoot, listed.leaseId);
        } catch (error) {
            if (!(error instanceof NbdevError) || error.code !== "invalid_record") throw error;
            continue;
        }
        if (!lease || !releasable(lease)) continue;
        const updated: LeaseRecord = {...lease, releasedAt: now.toISOString(), releaseReason: reason};
        try {
            await writeLease(mainRoot, updated);
        } catch (error) {
            if (!(error instanceof NbdevError) || error.code !== "write_failed") throw error;
            warnings.push({code: "lease_write_failed", message: `释放租约失败（记录操作不受影响）：${error.message}`, details: {...error.details, leaseId: lease.leaseId}});
            continue;
        }
        released.push(updated);
    }
    return {released, warnings};
}

/** 查一批租约里各会话进程是否还在（每个进程只查一次），供 `LeaseContext.processAlive` 使用。 */
export async function processLiveness(leases: readonly LeaseRecord[]): Promise<(process: ProcessRef) => boolean> {
    const alive = new Map<string, boolean>();
    for (const lease of leases) {
        const process = lease.session.process;
        if (process && !alive.has(processKey(process))) alive.set(processKey(process), await processAlive(process));
    }
    return (process) => alive.get(processKey(process)) ?? false;
}

/**
 * 现算有效性，按顺序：已释放；所属 Task 已 done 或 shelved；超过 24 小时；会话进程已不在；
 * 同一个进程后来出现了别的会话 id（`/clear` 或后台副本）时较早的会话；其余有效。
 * herdr 不参与判失效：herdr 记的“pane 上是哪个会话”会被嵌套的 `claude -p`、后台副本改写；herdr 只决定 `managed`（能不能通知），
 * 且只在租约记的 socket 与本次评估用的 socket 相同时才算。
 */
export function evaluateLeases(leases: readonly LeaseRecord[], context: LeaseContext): EvaluatedLease[] {
    const latestByProcess = new Map<string, {sessionKey: string; at: number}>();
    for (const lease of leases) {
        const process = lease.session.process;
        if (!process) continue;
        const at = Date.parse(lease.lastActivityAt);
        const current = latestByProcess.get(processKey(process));
        if (!current || at > current.at) latestByProcess.set(processKey(process), {sessionKey: lease.session.key, at});
    }
    return leases.map((lease) => {
        const process = lease.session.process;
        const idle = context.now.getTime() - Date.parse(lease.lastActivityAt);
        const status = context.taskStatus(lease.workId, lease.taskId);
        let state: LeaseState = "valid";
        if (lease.releasedAt !== null) state = "released";
        else if (status === "done" || status === "shelved") state = "task_closed";
        else if (idle > LEASE_EXPIRY_MS) state = "expired";
        else if (process && !context.processAlive(process)) state = "session_gone";
        else if (process && latestByProcess.get(processKey(process))?.sessionKey !== lease.session.key) state = "superseded";
        const herdr = lease.session.herdr;
        const managed = herdr !== null && context.herdr !== null && herdr.socketPath === context.herdr.socketPath
            && lease.session.sessionId !== null && context.herdr.sessionIds.has(lease.session.sessionId);
        return {...lease, state, stale: idle > LEASE_STALE_MS, managed};
    });
}

export function evaluateLease(lease: LeaseRecord, context: LeaseContext, others: readonly LeaseRecord[] = []): EvaluatedLease {
    return evaluateLeases([lease, ...others.filter((other) => other.leaseId !== lease.leaseId)], context)[0]!;
}
