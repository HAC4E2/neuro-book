import {spawn, type ChildProcess} from "node:child_process";
import {closeSync, constants, openSync} from "node:fs";
import {access, mkdir, open, readFile} from "node:fs/promises";
import {delimiter, isAbsolute, join, resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {checkoutKeys} from "../core/checkouts.js";
import {NbdevError, systemErrorCode, type Warning} from "../core/errors.js";
import type {Caller} from "../core/identity.js";
import {isRecord} from "../core/json.js";
import {processAlive, processStartTicks} from "../core/procfs.js";
import {AGENT_LOCAL_ROOT} from "../core/registry.js";
import {listCheckouts, type CheckoutInfo, type RepoContext} from "../core/repo.js";
import {collectDescendants, currentBootId, evaluateRun, mergeRefs, newRunId, readProcRecord, readProcRecords, stopRunProcesses, updateProcRecord, withProcsLock, writeProcRecord, PROC_SCHEMA, listProcRuns, type ProcRecord, type RunEvaluation, type RunView as ProcRunView, type StartedBy} from "../core/procs.js";
import {compileReadyPattern, createReadyMatcher, LineSplitter, readyStatus, stripAnsi} from "./ready.js";

/**
 * `nbdev dev start`、`dev status`、`dev stop`（t14）。合同见 docs/cli.md 的“dev”，登记见 docs/file-formats.md。
 *
 * `dev start` 自己就是监管进程，留在前台，由 Agent 的后台机制托管（Claude Code 的 `run_in_background`、omp 的 `proc://`），
 * 会话结束时随会话退出（全局规则“后台与长驻进程”）。服务的 stdout、stderr 直接是日志文件的描述符，监管进程不在了也不会 BrokenPipe。
 * Claude Code 的 TaskStop 给整棵树同时发 SIGTERM、约 1.5 秒后整棵 SIGKILL（t14 设计审查 S1）：收到信号先写登记、再发 SIGTERM，
 * 剩下的尽力而为。
 */

export const DEFAULT_READY_TIMEOUT_MS = 180_000;
export const DEFAULT_GRACE_MS = 10_000;
const TAIL_INTERVAL_MS = 200;
const SNAPSHOT_INTERVAL_MS = 2_000;
const PROBE_TIMEOUT_MS = 2_000;
const PROBE_INTERVAL_MS = 500;
/** 打过 `NOT_READY` 之后探测放慢：服务可能一直回 5xx，不必每半秒打它一次。 */
const LATE_PROBE_INTERVAL_MS = 2_000;
/** 组长自己退出之后补收剩下的进程时的宽限期：服务已经在收口，不必等满 10 秒。 */
const LEFTOVER_GRACE_MS = 3_000;

export type DevEvent =
    | {event: "ready"; runId: string; url: string; logPath: string; pid: number | null; reused: boolean; owner: string | null}
    | {event: "not_ready"; runId: string; logPath: string; lastStatus: number | null; reused: boolean; owner: string | null}
    | {event: "exited"; runId: string; exitCode: number | null; signal: string | null; leftovers: number};

export type DevTarget = {checkout: CheckoutInfo; key: string; packageDir: string; script: string};

export type DevStartInput = {checkoutRef: string | null; packageDir: string; script: string; task: {workId: string; taskId: string} | null; readyPattern: string | null; readyTimeoutMs: number; graceMs: number};

/** 找 checkout：`--checkout` 写 key 或路径；不写时取调用者所在的 checkout。 */
export async function resolveDevTarget(context: RepoContext, checkoutRef: string | null, packageDir: string, script: string, cwd: string): Promise<DevTarget> {
    const checkouts = (await listCheckouts(context.mainRoot)).filter((checkout) => !checkout.prunable);
    const keys = checkoutKeys(checkouts);
    const wanted = checkoutRef === null ? context.callerRoot : checkoutRef;
    const absolute = isAbsolute(wanted) ? wanted : resolve(cwd, wanted);
    const checkout = checkouts.find((entry) => keys.get(entry.root) === wanted) ?? checkouts.find((entry) => entry.root === absolute);
    if (!checkout) throw new NbdevError("usage", `找不到 checkout：${wanted}（写 checkout key 或路径）`, {details: {checkout: wanted, known: [...keys.values()]}});
    if (isAbsolute(packageDir) || packageDir.split("/").includes("..")) throw new NbdevError("usage", `--package 写 checkout 里的相对路径：${packageDir}`);
    return {checkout, key: keys.get(checkout.root)!, packageDir, script};
}

async function readScripts(dir: string): Promise<Record<string, unknown> | null> {
    try {
        const value = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as unknown;
        return isRecord(value) && isRecord(value.scripts) ? value.scripts : null;
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || error instanceof SyntaxError) return null;
        throw error;
    }
}

/** 在 `PATH` 里找可执行文件（Node 没有 `which`）。 */
export async function findExecutable(name: string, env: NodeJS.ProcessEnv): Promise<string | null> {
    for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
        const candidate = join(dir, name);
        try {
            await access(candidate, constants.X_OK);
            return candidate;
        } catch (error) {
            if (systemErrorCode(error) !== "ENOENT" && systemErrorCode(error) !== "EACCES" && systemErrorCode(error) !== "ENOTDIR") throw error;
        }
    }
    return null;
}

function startedByOf(caller: Caller): StartedBy | null {
    if (caller.kind !== "session") return null;
    return {key: caller.ref.key, agent: caller.ref.agent, label: caller.ref.label, process: caller.process};
}

function logPathFor(mainRoot: string, target: DevTarget, task: {workId: string; taskId: string} | null, runId: string): string {
    return task
        ? resolve(mainRoot, AGENT_LOCAL_ROOT, "works", task.workId, "tasks", task.taskId, "logs", `${runId}.log`)
        : resolve(mainRoot, AGENT_LOCAL_ROOT, "logs", "dev", `${target.key}-${runId}.log`);
}

function sameKey(record: ProcRecord, target: DevTarget): boolean {
    return record.checkout === target.checkout.root && record.package === target.packageDir && record.script === target.script;
}

/** HTTP 探测一次：回状态码，连不上回 null。 */
async function probeStatus(url: string): Promise<number | null> {
    try {
        const response = await fetch(url, {signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: "manual"});
        await response.body?.cancel();
        return response.status;
    } catch (error) {
        if (error instanceof Error) return null;
        throw error;
    }
}

/** 地址按就绪的判据回应（2xx 到 4xx）。 */
export async function urlReady(url: string): Promise<boolean> {
    const status = await probeStatus(url);
    return status !== null && readyStatus(status);
}

/**
 * 能复用的运行：组长还活着（`starting`、`running`、`supervisor_gone`）。`leader_exited` 只是开发脚本退出后没收掉的进程，
 * 服务早就不在了；它不算 `ended` 只是为了让 `dev stop` 收得到（t14 实现审查 I2）。`shot` 取地址用同一个判据。
 */
export function reusable(evaluation: Pick<RunEvaluation, "state" | "reason">): boolean {
    return evaluation.state === "starting" || evaluation.state === "running" || (evaluation.state === "orphaned" && evaluation.reason === "supervisor_gone");
}

type WaitReadyOptions = {
    deadline: number;
    shouldStop: () => boolean | Promise<boolean>;
    /** 认出地址时调一次（写进登记）。 */
    onUrl: (url: string) => Promise<void>;
    /** 给了就在到时限时调一次、然后接着等（监管进程打 `NOT_READY` 之后照样认就绪，t14 实现审查 I3）；不给就到时限结束。 */
    onTimeout?: (lastStatus: number | null) => Promise<void>;
};

/**
 * 从日志里等就绪（新起的与复用的共用）：逐段读日志、去 ANSI、按行认地址，认出之后 HTTP 探测到 2xx、3xx、4xx 为止。
 * 就绪回 `ready: true`；停下（`shouldStop`，或没给 `onTimeout` 时到时限）回 `ready: false` 与最后一次的状态码。
 */
async function waitReady(logPath: string, pattern: string | null, options: WaitReadyOptions): Promise<{ready: boolean; url: string | null; lastStatus: number | null}> {
    const matcher = createReadyMatcher(pattern ? compileReadyPattern(pattern) : null);
    const splitter = new LineSplitter();
    const decoder = new TextDecoder();
    let offset = 0;
    let lastStatus: number | null = null;
    let urlNoted = false;
    let nextProbe = 0;
    let timedOut = false;
    const handle = await open(logPath, "r");
    try {
        while (!await options.shouldStop()) {
            if (!timedOut && Date.now() >= options.deadline) {
                if (!options.onTimeout) break;
                timedOut = true;
                await options.onTimeout(lastStatus);
            }
            const buffer = Buffer.alloc(64 * 1024);
            for (;;) {
                const {bytesRead} = await handle.read(buffer, 0, buffer.length, offset);
                if (bytesRead === 0) break;
                offset += bytesRead;
                for (const line of splitter.push(decoder.decode(buffer.subarray(0, bytesRead), {stream: true}))) matcher.feed(stripAnsi(line));
            }
            const progress = matcher.progress();
            if (progress.url && !urlNoted) {
                urlNoted = true;
                await options.onUrl(progress.url);
            }
            if (progress.url && progress.ready && Date.now() >= nextProbe) {
                lastStatus = await probeStatus(progress.url);
                if (lastStatus !== null && readyStatus(lastStatus)) return {ready: true, url: progress.url, lastStatus};
                nextProbe = Date.now() + (timedOut ? LATE_PROBE_INTERVAL_MS : PROBE_INTERVAL_MS);
            }
            await sleep(TAIL_INTERVAL_MS);
        }
        return {ready: false, url: matcher.progress().url, lastStatus};
    } finally {
        await handle.close();
    }
}

export type DevStartResult = {exitCode: 0 | 1; warnings: Warning[]};

/**
 * `dev start`：复用同键（checkout、package、script）还活着的运行；没有就在锁里起服务、写好登记再放锁（t14 设计审查 I2），
 * 然后留在前台监管：认就绪、记后代快照、收信号、组长退出后补收剩下的进程。
 */
export async function devStart(context: RepoContext, cwd: string, input: DevStartInput, caller: Caller, env: NodeJS.ProcessEnv, emitEvent: (event: DevEvent) => void): Promise<DevStartResult> {
    const warnings: Warning[] = [];
    const target = await resolveDevTarget(context, input.checkoutRef, input.packageDir, input.script, cwd);
    const packageRoot = join(target.checkout.root, target.packageDir);
    const scripts = await readScripts(packageRoot);
    if (!scripts || typeof scripts[target.script] !== "string") throw new NbdevError("script_not_found", `${packageRoot}/package.json 里没有脚本 ${target.script}`, {details: {package: packageRoot, script: target.script}});
    if (input.readyPattern !== null) {
        try {
            compileReadyPattern(input.readyPattern);
        } catch (error) {
            if (error instanceof SyntaxError) throw new NbdevError("usage", `--ready-pattern 不是合法的正则：${error.message}`);
            throw error;
        }
    }
    const [setpriv, setsid] = await Promise.all([findExecutable("setpriv", env), findExecutable("setsid", env)]);
    if (!setpriv || !setsid) throw new NbdevError("tool_missing", "找不到 setpriv 或 setsid（util-linux）：没有它们，监管进程被杀时收不掉服务");
    const startedBy = startedByOf(caller);
    const bootId = await currentBootId();
    const supervisorTicks = await processStartTicks(process.pid);
    if (supervisorTicks === null) throw new NbdevError("internal", "读不到本进程的启动时刻（/proc）");

    // 同键的残留（组长已退、只剩没收掉的进程）先按停法收掉再起新的；监管进程已不在，按 dev stop 的属主判据不要 --force。
    // 停法要等宽限期，放在锁外（停法自己要拿登记锁）。
    for (const record of (await readProcRecords(context.mainRoot)).records.filter((entry) => sameKey(entry, target))) {
        const evaluation = await evaluateRun(record, bootId);
        if (evaluation.state !== "orphaned" || evaluation.reason !== "leader_exited") continue;
        await stopRun(context.mainRoot, record, `${startedBy?.key ?? "unknown"}（dev start 收残留）`, input.graceMs);
        warnings.push({code: "leftovers_stopped", message: `同键的 ${record.runId} 开发脚本已退出、只剩没收掉的进程，已按停法收掉再起新的`, details: {runId: record.runId}});
    }

    let child: ChildProcess | null = null;
    const picked = await withProcsLock(context.mainRoot, async (): Promise<{reused: ProcRecord; evaluation: RunEvaluation} | {fresh: ProcRecord}> => {
        const {records} = await readProcRecords(context.mainRoot);
        for (const record of records.filter((entry) => sameKey(entry, target))) {
            const evaluation = await evaluateRun(record, bootId);
            if (reusable(evaluation)) return {reused: record, evaluation};
        }
        const runId = newRunId();
        const logPath = logPathFor(context.mainRoot, target, input.task, runId);
        await mkdir(resolve(logPath, ".."), {recursive: true});
        // O_CREAT|O_EXCL：两份服务不会写进同一个日志、认到对方的就绪行（t14 设计审查 S3）。
        const fd = openSync(logPath, "wx", 0o600);
        const argv = [setpriv, "--pdeathsig", "TERM", "--", setsid, process.execPath, "run", target.script];
        try {
            child = spawn(argv[0]!, argv.slice(1), {cwd: packageRoot, env, stdio: ["pipe", fd, fd]});
        } finally {
            closeSync(fd);
        }
        const pid = child.pid;
        if (pid === undefined) throw new NbdevError("tool_missing", `起不来：${argv.join(" ")}`);
        const startTicks = await processStartTicks(pid);
        if (startTicks === null) throw new NbdevError("dev_exited", `服务刚起就退出了，日志：${logPath}`, {details: {logPath}});
        const record: ProcRecord = {
            schema: PROC_SCHEMA, runId, kind: "dev", checkout: target.checkout.root, checkoutKey: target.key, package: target.packageDir, script: target.script,
            argv: ["bun", "run", target.script], readyPattern: input.readyPattern, workId: input.task?.workId ?? null, taskId: input.task?.taskId ?? null, logPath, bootId,
            startedAt: new Date().toISOString(), startedBy, supervisor: {pid: process.pid, startTicks: supervisorTicks}, pid, pgid: pid, startTicks, descendants: [],
            url: null, readyAt: null, lastProbeStatus: null, stoppingAt: null, stoppedBy: null, endedAt: null, endedReason: null, exitCode: null, signal: null, leftovers: null, leftoverPids: [],
        };
        await writeProcRecord(context.mainRoot, record);
        return {fresh: record};
    });

    if ("reused" in picked) return reuse(context, picked.reused, picked.evaluation, input, caller, emitEvent, warnings);
    return supervise(context, picked.fresh, child!, input, emitEvent, warnings);
}

/**
 * 复用别人起的：按同一套规则读它的日志等就绪；参数与登记不同时给警告（t14 设计审查 I2、S5）。
 * 登记里已就绪的先探测一次地址，连不上报 `dev_unresponsive`，不替别人停服务（停要过 dev stop 的属主判据）。
 */
async function reuse(context: RepoContext, record: ProcRecord, evaluation: RunEvaluation, input: DevStartInput, caller: Caller, emitEvent: (event: DevEvent) => void, warnings: Warning[]): Promise<DevStartResult> {
    const differences: string[] = [];
    if (input.readyPattern !== null && input.readyPattern !== record.readyPattern) differences.push("ready-pattern");
    if (input.task && (input.task.workId !== record.workId || input.task.taskId !== record.taskId)) differences.push("work/task");
    if (differences.length > 0) warnings.push({code: "reused_with_different_options", message: `复用了已在跑的服务，这些参数与它起时不同、没有生效：${differences.join("、")}`, details: {runId: record.runId, differences}});
    const owner = record.startedBy?.key ?? null;
    const mine = caller.kind === "session" && owner === caller.ref.key;
    if (!mine) warnings.push({code: "reused_other_owner", message: `这份服务由 ${owner ?? "未认出的调用者"} 起，随它的会话结束而停；要独立的一份请换 checkout`, details: {runId: record.runId, owner}});
    if (evaluation.state === "orphaned") warnings.push({code: "supervisor_gone", message: `没有人监管 ${record.runId}（监管进程不在了），用完请 nbdev dev stop ${record.runId}`, details: {runId: record.runId}});
    if (record.readyAt && record.url) {
        if (!await urlReady(record.url)) {
            throw new NbdevError("dev_unresponsive", `同键的 ${record.runId} 登记为已就绪，但地址 ${record.url} 现在连不上：先 nbdev dev stop ${record.runId}${mine || evaluation.state === "orphaned" ? "" : "（不是你起的、它的属主还在要加 --force）"}，再起`, {
                details: {runId: record.runId, url: record.url, owner},
            });
        }
        emitEvent({event: "ready", runId: record.runId, url: record.url, logPath: record.logPath, pid: record.pid, reused: true, owner});
        return {exitCode: 0, warnings};
    }
    // 等的时候每秒重读一次登记：复用的服务在就绪之前结束了就不再等满时限、也不打 NOT_READY（t14 实现审查 S1）。
    const bootId = await currentBootId();
    let ended: ProcRecord | null = null;
    let nextCheck = 0;
    const result = await waitReady(record.logPath, record.readyPattern, {
        deadline: Date.now() + input.readyTimeoutMs,
        onUrl: async () => undefined,
        shouldStop: async () => {
            if (Date.now() < nextCheck) return false;
            nextCheck = Date.now() + 1_000;
            const latest = await readProcRecord(context.mainRoot, record.runId) ?? record;
            if ((await evaluateRun(latest, bootId)).state !== "ended") return false;
            ended = latest;
            return true;
        },
    });
    if (ended !== null) {
        const gone: ProcRecord = ended;
        emitEvent({event: "exited", runId: record.runId, exitCode: gone.exitCode, signal: gone.signal, leftovers: gone.leftovers ?? 0});
        return {exitCode: 1, warnings};
    }
    const fresh = await readProcRecord(context.mainRoot, record.runId) ?? record;
    if (result.ready && result.url) {
        // 认出就绪写回登记（锁内，只在还没有 readyAt 时写）：`dev status --wait-ready`、`shot` 只看登记（t14 实现审查 I3）。
        const readyUrl = result.url;
        await updateProcRecord(context.mainRoot, record.runId, (entry) => {
            if (entry.readyAt !== null || entry.endedAt !== null) return;
            entry.url = readyUrl;
            entry.readyAt = new Date().toISOString();
            entry.lastProbeStatus = result.lastStatus;
        });
        emitEvent({event: "ready", runId: record.runId, url: result.url, logPath: record.logPath, pid: fresh.pid, reused: true, owner});
    } else emitEvent({event: "not_ready", runId: record.runId, logPath: record.logPath, lastStatus: result.lastStatus, reused: true, owner});
    return {exitCode: 0, warnings};
}

/** 前台监管：就绪、快照、信号、退出。 */
async function supervise(context: RepoContext, initial: ProcRecord, child: ChildProcess, input: DevStartInput, emitEvent: (event: DevEvent) => void, warnings: Warning[]): Promise<DevStartResult> {
    const {mainRoot} = context;
    const runId = initial.runId;
    let record = initial;
    let stopping: Promise<void> | null = null;
    let stoppedBySignal = false;
    const exited = new Promise<{code: number | null; signal: NodeJS.Signals | null}>((done) => child.once("exit", (code, signal) => done({code, signal})));
    let leaderGone = false;
    void exited.then(() => {
        leaderGone = true;
    });

    const update = async (mutate: (entry: ProcRecord) => void, waitMs?: number) => {
        const next = await updateProcRecord(mainRoot, runId, mutate, waitMs);
        if (next) record = next;
    };

    // 收到信号：先同步记下“正在停”与是谁停的，再给组长发 SIGTERM，在 TaskStop 的 1.5 秒内做完这两步（t14 设计审查 S1）；剩下的尽力而为。
    const onSignal = (signal: NodeJS.Signals) => {
        if (stopping) return;
        stoppedBySignal = true;
        stopping = (async () => {
            try {
                await update((entry) => {
                    entry.stoppingAt ??= new Date().toISOString();
                    entry.stoppedBy ??= `signal:${signal}`;
                }, 1_000);
            } catch (error) {
                if (!(error instanceof NbdevError)) throw error;
                warnings.push({code: "proc_record_write_failed", message: `收到 ${signal} 时没能写登记：${error.message}`, details: {runId}});
            }
            await stopRunProcesses(record, {graceMs: input.graceMs});
        })();
    };
    const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];
    for (const signal of signals) process.on(signal, onSignal);

    const snapshotTimer = setInterval(() => {
        void (async () => {
            if (leaderGone || record.pid === null || record.startTicks === null) return;
            // 组长是本进程的子进程、还没收尸，组号就是我们的：组里的进程一并记下。
            const found = await collectDescendants([{pid: record.pid, startTicks: record.startTicks}], record.descendants, record.pgid);
            const merged = mergeRefs(record.descendants, found);
            if (merged.length !== record.descendants.length) await update((entry) => {
                entry.descendants = mergeRefs(entry.descendants, found);
            });
        })().catch((error: unknown) => warnings.push({code: "proc_snapshot_failed", message: `记后代快照失败：${error instanceof Error ? error.message : String(error)}`}));
    }, SNAPSHOT_INTERVAL_MS);

    try {
        // 到 --ready-timeout 打 NOT_READY，之后照样读日志、探测，就绪时补写登记、再打 READY（t14 实现审查 I3）。
        const readiness = waitReady(record.logPath, input.readyPattern, {
            deadline: Date.now() + input.readyTimeoutMs,
            shouldStop: () => leaderGone || stopping !== null,
            onUrl: async (url) => {
                await update((entry) => {
                    entry.url = url;
                });
            },
            onTimeout: async (lastStatus) => {
                await update((entry) => {
                    entry.lastProbeStatus = lastStatus;
                });
                emitEvent({event: "not_ready", runId, logPath: record.logPath, lastStatus, reused: false, owner: record.startedBy?.key ?? null});
            },
        }).then(async (result) => {
            if (leaderGone || stopping || !result.ready || !result.url) return;
            const url = result.url;
            await update((entry) => {
                entry.url = url;
                entry.readyAt ??= new Date().toISOString();
                entry.lastProbeStatus = result.lastStatus;
            });
            emitEvent({event: "ready", runId, url, logPath: record.logPath, pid: record.pid, reused: false, owner: record.startedBy?.key ?? null});
        });
        const {code, signal} = await exited;
        await readiness.catch((error: unknown) => warnings.push({code: "ready_watch_failed", message: `读日志认就绪时出错：${error instanceof Error ? error.message : String(error)}`}));
        // 组长退出之后：是“正在停”就等停法走完；否则（服务自己退出）补收组里与快照里剩下的进程（t14 设计审查 I1）。
        let leftovers = 0;
        let leftoverPids: number[] = [];
        if (stopping) await stopping;
        // 组长刚由本进程收尸：组里还有进程时组号不会被复用，组里剩下的都是这份运行的，趁现在记进快照
        // （读者只凭快照里的组员认这个组，t14 实现审查 I1）。
        const members = await collectDescendants([], record.descendants, record.pgid);
        if (members.length > 0) await update((entry) => {
            entry.descendants = mergeRefs(entry.descendants, members);
        });
        const latest = await readProcRecord(mainRoot, runId) ?? record;
        const wasStopping = latest.stoppingAt !== null;
        const evaluation = await evaluateRun({...latest, endedAt: null}, latest.bootId);
        if (evaluation.groupAlive || evaluation.aliveDescendants.length > 0) {
            leftovers = evaluation.aliveDescendants.length + (evaluation.groupAlive ? 1 : 0);
            const outcome = await stopRunProcesses(latest, {graceMs: wasStopping ? input.graceMs : LEFTOVER_GRACE_MS});
            leftoverPids = outcome.leftoverPids;
        }
        await update((entry) => {
            entry.endedAt ??= new Date().toISOString();
            entry.endedReason ??= wasStopping ? "stopped" : "exited";
            entry.exitCode = code;
            entry.signal = signal;
            entry.leftovers = leftovers;
            entry.leftoverPids = leftoverPids;
        });
        emitEvent({event: "exited", runId, exitCode: code, signal, leftovers});
        if (leftoverPids.length > 0) warnings.push({code: "stop_incomplete", message: `还有进程没收掉：${leftoverPids.join("、")}`, details: {runId, leftoverPids}});
        // 服务自己退出算失败（dev_exited）；被 dev stop 或信号停掉算正常结束（t14 设计审查 S6）。
        return {exitCode: wasStopping || stoppedBySignal ? (leftoverPids.length > 0 ? 1 : 0) : 1, warnings};
    } finally {
        clearInterval(snapshotTimer);
        for (const signal of signals) process.off(signal, onSignal);
        child.stdin?.destroy();
    }
}

export {listProcRuns as listRuns, type RunView} from "../core/procs.js";

export type StopInput = {runId: string | null; target: DevTarget | null; force: boolean; graceMs: number};

/**
 * `dev stop`：已结束的只补登记、不发信号；属主核对（t14 设计审查 S4）：监管进程不在、属主会话已不在、调用者就是属主，三者任一就不要 `--force`。
 * 先写 `stoppingAt`、`stoppedBy`，再按停法停；核对不过时报 `stop_incomplete`。
 */
export async function devStop(mainRoot: string, input: StopInput, caller: Caller): Promise<{stopped: string[]; skipped: Array<{runId: string; reason: string}>}> {
    const {records} = await readProcRecords(mainRoot);
    const bootId = await currentBootId();
    let candidates: ProcRecord[];
    if (input.runId !== null) candidates = records.filter((record) => record.runId === input.runId);
    else {
        const target = input.target!;
        const matching = records.filter((record) => sameKey(record, target));
        const alive: ProcRecord[] = [];
        for (const record of matching) if ((await evaluateRun(record, bootId)).state !== "ended") alive.push(record);
        candidates = alive;
        if (candidates.length === 0 && matching.length > 0) candidates = [matching.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]!];
    }
    if (candidates.length === 0) throw new NbdevError("run_not_found", input.runId ? `找不到运行：${input.runId}` : "这个 checkout 上没有经 nbdev 起的这份服务", {details: {runId: input.runId}});
    const callerKey = caller.kind === "session" ? caller.ref.key : null;
    const stopped: string[] = [];
    const skipped: Array<{runId: string; reason: string}> = [];
    for (const record of candidates) {
        const evaluation = await evaluateRun(record, bootId);
        if (evaluation.state === "ended") {
            if (!record.endedAt) await updateProcRecord(mainRoot, record.runId, (entry) => {
                entry.endedAt ??= new Date().toISOString();
                entry.endedReason ??= evaluation.reason;
            });
            skipped.push({runId: record.runId, reason: evaluation.reason ?? "ended"});
            continue;
        }
        const ownerGone = record.startedBy?.process ? !await processAlive(record.startedBy.process) : false;
        const isOwner = callerKey !== null && record.startedBy?.key === callerKey;
        if (evaluation.supervisorAlive && !ownerGone && !isOwner && !input.force) {
            const owner = record.startedBy;
            throw new NbdevError("run_owned_by_other", `${record.runId} 由 ${owner ? `${owner.agent} 会话 ${owner.key}` : "未认出的调用者"} 起，它还在监管；确认要停就加 --force`, {
                details: {runId: record.runId, owner: owner ? {key: owner.key, agent: owner.agent, label: owner.label, alive: true} : null},
            });
        }
        await stopRun(mainRoot, record, `${callerKey ?? "unknown"}${input.force && !isOwner ? "（--force）" : ""}`, input.graceMs);
        stopped.push(record.runId);
    }
    return {stopped, skipped};
}

/** 按停法停一份运行（`dev stop` 与 `dev start` 收残留共用）：先写 `stoppingAt`、`stoppedBy`，再停，核对不过报 `stop_incomplete`。 */
async function stopRun(mainRoot: string, record: ProcRecord, by: string, graceMs: number): Promise<void> {
    const latest = await updateProcRecord(mainRoot, record.runId, (entry) => {
        entry.stoppingAt ??= new Date().toISOString();
        entry.stoppedBy = by;
    }) ?? record;
    const outcome = await stopRunProcesses(latest, {graceMs});
    // 监管进程还在时由它补 endedAt；等它一会儿，不在了（或本来就不在）就自己补。
    for (let waited = 0; waited < 3_000 && await processAlive(latest.supervisor); waited += 100) await sleep(100);
    await updateProcRecord(mainRoot, record.runId, (entry) => {
        entry.endedAt ??= new Date().toISOString();
        entry.endedReason ??= "stopped";
        if (!outcome.clean) entry.leftoverPids = outcome.leftoverPids;
    });
    if (!outcome.clean) {
        throw new NbdevError("stop_incomplete", `停 ${record.runId} 之后还有进程没收掉${outcome.urlResponding ? "，地址仍有回应" : ""}：${outcome.leftoverPids.join("、") || "（未知）"}`, {
            details: {runId: record.runId, leftoverPids: outcome.leftoverPids, urlResponding: outcome.urlResponding},
        });
    }
}

/** `dev status --wait-ready`：等这份服务就绪，超时报 `dev_not_ready`。 */
export async function waitRunReady(mainRoot: string, target: DevTarget, timeoutMs: number): Promise<ProcRunView> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const {runs} = await listProcRuns(mainRoot);
        const run = runs.filter((entry) => sameKey(entry, target) && entry.state !== "ended").sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
        if (!run) throw new NbdevError("run_not_found", "这个 checkout 上没有经 nbdev 起的这份服务", {details: {checkout: target.checkout.root}});
        if (run.readyAt) return run;
        if (Date.now() > deadline) throw new NbdevError("dev_not_ready", `${run.runId} 在 ${Math.round(timeoutMs / 1000)} 秒内没有就绪，日志：${run.logPath}`, {details: {runId: run.runId, logPath: run.logPath}});
        await sleep(500);
    }
}
