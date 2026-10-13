import {randomBytes} from "node:crypto";
import {watch, type FSWatcher} from "node:fs";
import {resolve} from "node:path";
import type {HerdrClient} from "../herdr/client.js";
import {readActivity, readPaneProcesses, type Activity, type HerdrSnapshot} from "../core/activity.js";
import {checkoutKeys} from "../core/checkouts.js";
import {systemErrorCode, type Warning} from "../core/errors.js";
import {gitOutput, runGit} from "../core/git.js";
import {LEASES_DIR} from "../core/leases.js";
import {AGENT_LOCAL_ROOT} from "../core/registry.js";
import {MASTER_REF, WORKS_ROOT, type CheckoutInfo, type RepoContext} from "../core/repo.js";
import {createBranchChangesCache} from "../core/sources.js";
import {readProjectRecords, readTransitionState, type ProjectRecords, type TransitionState} from "../core/status.js";
import {HerdrMonitor} from "./herdr-monitor.js";

/**
 * 面板的内存缓存：页面请求只读这里，从不现算整份 `status`。分三块各自刷新，变了就经 `/ws` 推“哪块变了”：
 * - **记录**（Work、Task、收件箱、撞号）：`fs.watch` 递归监视主工作区的 `.agents/works/`（去抖 300 毫秒，过滤 `evidences/`）；
 *   每 5 秒看一次 checkout 列表与各 HEAD，变了才重算（过渡期判定按 HEAD 缓存）；有浏览器连着时每 30 秒兜底整份重算，
 *   顺带重算各 worktree 未提交的记录改动（它们不改 HEAD，也不在监视范围里）。
 * - **活动**（租约、会话、运行）：租约是否有效是读取时现算的（会话退出、过期、Task 关闭都不碰租约文件），
 *   所以有浏览器连着时每 5 秒整份重算；记录或会话变化时也重算。监视租约目录只当加速。
 * - **会话**：`HerdrMonitor`。
 * 每块的重算单飞并合并；失败时保留上一份，在 `meta` 里标错。只有显示用到的字段变了才增加 revision。
 */

export type Part<T> = {value: T | null; revision: number; at: string | null; error: string | null};
export type PartName = "records" | "activity" | "sessions";
export type RecordsValue = {records: ProjectRecords; transition: TransitionState; warnings: Warning[]};
export type ActivityValue = {activity: Activity; warnings: Warning[]};

const DEBOUNCE_MS = 300;
const CHECK_MS = 5_000;
const FALLBACK_MS = 30_000;

/** 面板代码所在的树（与 `.build-hash` 的输入一致）：master 上只改记录时它不变，所以“代码已更新”不会每次答复都冒出来。 */
export const CODE_PATHS = ["packages/dev-panel", "packages/nb-ui", "bun.lock"];

export async function readCodeKey(mainRoot: string): Promise<string> {
    const results = await Promise.all(CODE_PATHS.map((path) => runGit(mainRoot, ["rev-parse", `HEAD:${path}`], {readOnly: true})));
    return results.map((result) => (result.exitCode === 0 ? result.stdout.trim() : "-")).join(",");
}

class Refresher<T> {
    part: Part<T> = {value: null, revision: 0, at: null, error: null};
    private fingerprint = "";
    private running: Promise<void> | null = null;
    /** 正在算时又被要求重算：合并成一次排在后面的重算。 */
    private queued: {promise: Promise<void>; resolve: () => void} | null = null;

    constructor(private readonly name: PartName, private readonly compute: () => Promise<T>, private readonly fingerprintOf: (value: T) => string, private readonly onChanged: (name: PartName) => void, private readonly log: (message: string) => void) {}

    /**
     * 重算一次，返回的承诺在一次“调用之后才开始”的重算完成时兑现：正在算的那次可能读的是写入之前的文件，
     * 写接口要等到包含自己这次写入的结果再回应（前端紧接着跳到新 Work 不会 404）。
     */
    run(): Promise<void> {
        if (this.running) {
            if (!this.queued) {
                let resolve!: () => void;
                const promise = new Promise<void>((done) => {
                    resolve = done;
                });
                this.queued = {promise, resolve};
            }
            return this.queued.promise;
        }
        this.running = this.once().finally(() => {
            this.running = null;
            const queued = this.queued;
            if (queued) {
                this.queued = null;
                void this.run().finally(() => queued.resolve());
            }
        });
        return this.running;
    }

    private async once(): Promise<void> {
        try {
            const value = await this.compute();
            const print = this.fingerprintOf(value);
            const changed = print !== this.fingerprint;
            this.part = {value, revision: changed ? this.part.revision + 1 : this.part.revision, at: new Date().toISOString(), error: null};
            this.fingerprint = print;
            if (changed) this.onChanged(this.name);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`重算 ${this.name} 失败，保留上一份：${message}`);
            if (!(error instanceof Error)) throw error;
            this.part = {...this.part, error: message};
            this.onChanged(this.name);
        }
    }
}

/** 活动里显示用到的字段：运行的子进程数随时在变，不进指纹。 */
function activityFingerprint(value: ActivityValue): string {
    const {activity} = value;
    return JSON.stringify({
        leases: activity.leases.filter((lease) => lease.state === "valid").map((lease) => [lease.leaseId, lease.taskId, lease.stale, lease.lastActivityAt]),
        sessions: activity.sessions.map((session) => [session.key, session.alive, session.herdr?.status ?? null, session.leases.length, session.runs.map((run) => [run.pid, run.command, run.checkout])]),
        unowned: activity.unownedRuns.map((run) => [run.pid, run.command, run.checkout]),
    });
}

export class PanelState {
    readonly instanceId = randomBytes(8).toString("hex");
    readonly startedAt = new Date().toISOString();
    readonly herdr: HerdrMonitor;
    readonly records: Refresher<RecordsValue>;
    readonly activity: Refresher<ActivityValue>;
    checkouts: CheckoutInfo[] = [];
    keys = new Map<string, string>();
    codeKey = "";
    codeChanged = false;
    build: {failed: boolean; message: string | null} = {failed: false, message: null};
    private readonly cache = createBranchChangesCache();
    private checkoutPrint = "";
    private clients = 0;
    private watchers: FSWatcher[] = [];
    private timers: Array<ReturnType<typeof setInterval>> = [];
    private debounce: ReturnType<typeof setTimeout> | null = null;
    private listeners = new Set<(part: PartName) => void>();

    constructor(readonly context: RepoContext, herdrClient: HerdrClient | null, readonly log: (message: string) => void) {
        const changed = (part: PartName) => {
            for (const listener of this.listeners) listener(part);
            if (part === "records" || part === "sessions") void this.activity.run();
        };
        this.herdr = new HerdrMonitor(herdrClient, () => {
            this.sessionsRevision += 1;
            changed("sessions");
        }, log);
        this.records = new Refresher("records", () => this.computeRecords(), (value) => JSON.stringify(value.records), changed, log);
        this.activity = new Refresher("activity", () => this.computeActivity(herdrClient), activityFingerprint, changed, log);
    }

    sessionsRevision = 0;
    /** `stop()` 之后为 true：之后的 `watchAll()` 与 herdr 的 `start()` 都不再挂监视与定时器。 */
    stopped = false;

    onChange(listener: (part: PartName) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    revisions(): Record<PartName, number> {
        return {records: this.records.part.revision, activity: this.activity.part.revision, sessions: this.sessionsRevision};
    }

    keyOf(root: string): string | null {
        return this.keys.get(root) ?? null;
    }

    checkoutByKey(key: string): CheckoutInfo | null {
        return this.checkouts.find((checkout) => this.keys.get(checkout.root) === key && !checkout.prunable) ?? null;
    }

    private async computeRecords(): Promise<RecordsValue> {
        const transition = await readTransitionState(this.context.mainRoot, this.cache);
        this.checkouts = transition.checkouts;
        this.keys = checkoutKeys(transition.checkouts);
        const {records, warnings} = await readProjectRecords(this.context, transition);
        return {records, transition, warnings: [...transition.warnings, ...warnings]};
    }

    private async computeActivity(client: HerdrClient | null): Promise<ActivityValue> {
        const transition = this.records.part.value?.transition ?? await readTransitionState(this.context.mainRoot, this.cache);
        const warnings: Warning[] = [];
        const herdr = this.herdr.current();
        const snapshot: HerdrSnapshot = herdr.available && client
            ? {available: true, socketPath: herdr.socketPath, version: herdr.version, panes: herdr.panes, processes: await readPaneProcesses(client, herdr.panes, warnings)}
            : {available: false, socketPath: herdr.socketPath, version: null, panes: [], processes: null};
        const {activity, warnings: activityWarnings} = await readActivity(this.context.mainRoot, transition, {herdr: null, now: new Date(), selfPid: process.pid, snapshot});
        return {activity, warnings: [...warnings, ...activityWarnings]};
    }

    /** 预热：记录与活动各算一遍（herdr 不等，随后补上）。 */
    async warm(): Promise<void> {
        this.codeKey = await readCodeKey(this.context.mainRoot);
        this.herdr.start();
        await this.records.run();
        await this.activity.run();
        this.checkoutPrint = await this.checkoutFingerprint();
    }

    /** 开始监视与定时检查。 */
    watchAll(): void {
        if (this.stopped) return;
        const {mainRoot} = this.context;
        this.watchRecords(resolve(mainRoot, WORKS_ROOT));
        this.watchLeases();
        this.timers.push(setInterval(() => void this.periodicCheck(), CHECK_MS));
        this.timers.push(setInterval(() => {
            if (this.clients === 0) return;
            this.cache.uncommitted.clear();
            void this.records.run();
        }, FALLBACK_MS));
    }

    clientConnected(): void {
        this.clients += 1;
        this.herdr.setActive(true);
    }

    clientDisconnected(): void {
        this.clients = Math.max(0, this.clients - 1);
        if (this.clients === 0) this.herdr.setActive(false);
    }

    stop(): void {
        this.stopped = true;
        for (const watcher of this.watchers) watcher.close();
        for (const timer of this.timers) clearInterval(timer);
        if (this.debounce) clearTimeout(this.debounce);
        this.herdr.stop();
    }

    private scheduleRecords(): void {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
            this.debounce = null;
            void this.records.run();
        }, DEBOUNCE_MS);
    }

    private watchRecords(path: string): void {
        try {
            const watcher = watch(path, {recursive: true}, (_event, filename) => {
                // 证据目录从不进索引，会话一次写一批截图不该触发一串重算。
                const name = typeof filename === "string" ? filename : "";
                if (name.split("/").includes("evidences")) return;
                this.scheduleRecords();
            });
            watcher.on("error", (error) => this.log(`监视 ${path} 出错，改靠 5 秒的检查与 30 秒的兜底：${error.message}`));
            this.watchers.push(watcher);
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            this.log(`没能监视 ${path}，改靠 5 秒的检查与 30 秒的兜底：${error.message}`);
        }
    }

    /** 租约目录可能还不存在（面板只读，不建它）：先监视 `.local/agent/`，都不在就只靠 5 秒的重算。 */
    private watchLeases(): void {
        const {mainRoot} = this.context;
        for (const [path, recursive] of [[resolve(mainRoot, LEASES_DIR), false], [resolve(mainRoot, AGENT_LOCAL_ROOT), true]] as const) {
            try {
                const watcher = watch(path, {recursive}, (_event, filename) => {
                    if (recursive && !(typeof filename === "string" && filename.startsWith("run/leases"))) return;
                    void this.activity.run();
                });
                watcher.on("error", (error) => this.log(`监视 ${path} 出错：${error.message}`));
                this.watchers.push(watcher);
                return;
            } catch (error) {
                if (systemErrorCode(error) !== "ENOENT") throw error;
            }
        }
        this.log("租约目录与 .local/agent/ 都还不存在，活动只靠 5 秒的重算");
    }

    private async checkoutFingerprint(): Promise<string> {
        const [list, master] = await Promise.all([
            gitOutput(this.context.mainRoot, ["worktree", "list", "--porcelain", "-z"], {readOnly: true}),
            runGit(this.context.mainRoot, ["rev-parse", "--verify", "--quiet", MASTER_REF], {readOnly: true}),
        ]);
        return `${master.stdout.trim()}\n${list}`;
    }

    private async periodicCheck(): Promise<void> {
        try {
            const print = await this.checkoutFingerprint();
            if (print !== this.checkoutPrint) {
                this.checkoutPrint = print;
                void this.records.run();
            }
            const code = await readCodeKey(this.context.mainRoot);
            if (code !== this.codeKey && !this.codeChanged) {
                this.codeChanged = true;
                for (const listener of this.listeners) listener("records");
            }
            if (this.clients > 0) void this.activity.run();
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            this.log(`定时检查失败：${error.message}`);
        }
    }
}
