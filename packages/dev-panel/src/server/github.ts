import {spawn} from "node:child_process";
import {constants} from "node:fs";
import {access} from "node:fs/promises";
import {delimiter, isAbsolute, join} from "node:path";
import {systemErrorCode} from "../core/errors.js";
import {isRecord} from "../core/json.js";

/**
 * 面板的 GitHub 只读视图（t14）：只调白名单里的两条 `gh … list`，参数写死，不接受任意子命令（与 herdr 的白名单同一种做法）。
 * 按仓库维护流程“Pull Request 与合并”一节，远端只读按最小字段读取：不取 `body`、`comments`、`reviews`；标题与标签是外部的不可信内容，
 * 页面按纯文本渲染、链接只收 `https:`。合同见 docs/panel.md 的“GitHub”。
 */

export const GH_LIMIT = 100;
const PR_FIELDS = "number,title,headRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt,url";
const ISSUE_FIELDS = "number,title,labels,updatedAt,url";
/** 写死的两条命令（`tests/panel-live.test.ts` 钉住）。 */
export const GH_COMMANDS = {
    prs: ["pr", "list", "--state", "open", "--limit", String(GH_LIMIT), "--json", PR_FIELDS],
    issues: ["issue", "list", "--state", "open", "--limit", String(GH_LIMIT), "--json", ISSUE_FIELDS],
} as const;
const TIMEOUT_MS = 15_000;
const KILL_AFTER_MS = 2_000;
/** 有浏览器连着时多久刷新一次；没人看时只在打开页面时取（t14 设计审查 S8）。 */
export const GH_REFRESH_MS = 5 * 60_000;
/**
 * 上一次没取到（没登录、找不到 gh、出错、超时）时，打开页面至少隔这么久才再取；手动“刷新”不受限。
 * 失败得多快就重取多快，会把一次失败放大成对 gh 与 GitHub 的连续请求（t14 实现审查 B1）。
 */
export const GH_RETRY_AFTER_FAILURE_MS = 60_000;
/** gh 以 4 退出：没登录（gh 的退出码约定）。 */
const GH_AUTH_REQUIRED = 4;

/** `failed` 的 `workflow`：CheckRun 所在的工作流（`workflowName`），不同工作流里可能有同名的检查；StatusContext 没有，为 null。 */
export type CheckSummary = {success: number; failure: number; pending: number; failed: Array<{name: string; workflow: string | null; url: string | null}>};
export type PrView = {number: number; title: string; branch: string; draft: boolean; reviewDecision: string | null; updatedAt: string; url: string | null; checks: CheckSummary};
export type IssueView = {number: number; title: string; labels: string[]; updatedAt: string; url: string | null};
export type GithubState = "idle" | "ok" | "stale" | "unavailable" | "not_logged_in" | "error";
export type GithubView = {state: GithubState; at: string | null; error: string | null; refreshing: boolean; prs: PrView[]; issues: IssueView[]; truncated: {prs: boolean; issues: boolean}};

function httpsUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try {
        return new URL(value).protocol === "https:" ? value : null;
    } catch (error) {
        if (error instanceof TypeError) return null;
        throw error;
    }
}

/** 检查汇总：`CheckRun` 看 `status` 与 `conclusion`，`StatusContext`（commit status）看 `state`（t14 设计审查 S8）。 */
export function summarizeChecks(rollup: unknown): CheckSummary {
    const summary: CheckSummary = {success: 0, failure: 0, pending: 0, failed: []};
    if (!Array.isArray(rollup)) return summary;
    for (const item of rollup) {
        if (!isRecord(item)) continue;
        let outcome: "success" | "failure" | "pending";
        let name: string;
        let workflow: string | null = null;
        let url: string | null;
        if (item.__typename === "StatusContext") {
            name = typeof item.context === "string" ? item.context : "status";
            url = httpsUrl(item.targetUrl);
            outcome = item.state === "SUCCESS" ? "success" : item.state === "FAILURE" || item.state === "ERROR" ? "failure" : "pending";
        } else {
            name = typeof item.name === "string" ? item.name : "check";
            workflow = typeof item.workflowName === "string" && item.workflowName !== "" ? item.workflowName : null;
            url = httpsUrl(item.detailsUrl);
            if (item.status !== "COMPLETED") outcome = "pending";
            else outcome = ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(String(item.conclusion)) ? "success" : "failure";
        }
        summary[outcome] += 1;
        if (outcome === "failure") summary.failed.push({name, workflow, url});
    }
    return summary;
}

export function parsePrs(text: string): PrView[] {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) throw new SyntaxError("gh pr list 的输出不是数组");
    return value.filter(isRecord).map((entry) => ({
        number: Number(entry.number),
        title: String(entry.title ?? ""),
        branch: String(entry.headRefName ?? ""),
        draft: entry.isDraft === true,
        reviewDecision: typeof entry.reviewDecision === "string" && entry.reviewDecision !== "" ? entry.reviewDecision : null,
        updatedAt: String(entry.updatedAt ?? ""),
        url: httpsUrl(entry.url),
        checks: summarizeChecks(entry.statusCheckRollup),
    }));
}

export function parseIssues(text: string): IssueView[] {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) throw new SyntaxError("gh issue list 的输出不是数组");
    return value.filter(isRecord).map((entry) => ({
        number: Number(entry.number),
        title: String(entry.title ?? ""),
        labels: Array.isArray(entry.labels) ? entry.labels.filter(isRecord).map((label) => String(label.name ?? "")).filter(Boolean) : [],
        updatedAt: String(entry.updatedAt ?? ""),
        url: httpsUrl(entry.url),
    }));
}

async function executable(path: string): Promise<boolean> {
    try {
        await access(path, constants.X_OK);
        return true;
    } catch (error) {
        const code = systemErrorCode(error);
        if (code === "ENOENT" || code === "EACCES" || code === "ENOTDIR") return false;
        throw error;
    }
}

async function onPath(name: string, env: NodeJS.ProcessEnv): Promise<string | null> {
    for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) if (await executable(join(dir, name))) return join(dir, name);
    return null;
}

/**
 * `gh` 的路径：先看 `NBDEV_GH_BIN`（绝对路径；`install-service` 写进单元，因为用户管理器的 `PATH` 不保证有 `~/.local/bin`，t14 设计审查 I5），
 * 再找 `PATH`。`NBDEV_GH_PREFIX` 给了（例如 `prox`）就放在前面，前缀的第一个词同样在 `PATH` 里找。
 */
export async function resolveGh(env: NodeJS.ProcessEnv): Promise<{argv: string[]} | {reason: string}> {
    let gh: string | null = null;
    if (env.NBDEV_GH_BIN) {
        if (!isAbsolute(env.NBDEV_GH_BIN) || !await executable(env.NBDEV_GH_BIN)) return {reason: `NBDEV_GH_BIN 不是可执行的绝对路径：${env.NBDEV_GH_BIN}`};
        gh = env.NBDEV_GH_BIN;
    } else gh = await onPath("gh", env);
    if (!gh) return {reason: "找不到 gh：设 NBDEV_GH_BIN 为它的绝对路径（作为服务运行时由 install-service 写进单元）"};
    const prefix = (env.NBDEV_GH_PREFIX ?? "").split(/\s+/u).filter(Boolean);
    if (prefix.length > 0) {
        const first = isAbsolute(prefix[0]!) ? prefix[0]! : await onPath(prefix[0]!, env);
        if (!first) return {reason: `找不到 NBDEV_GH_PREFIX 里的 ${prefix[0]}`};
        prefix[0] = first;
    }
    return {argv: [...prefix, gh]};
}

type RunResult = {code: number | null; stdout: string; stderr: string; timedOut: boolean};

function runGh(argv: readonly string[], args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
    return new Promise((resolvePromise, rejectPromise) => {
        // 服务里没有 TTY：禁掉交互提示与升级提示，不然只能等到超时（t14 设计审查 S8）。
        const child = spawn(argv[0]!, [...argv.slice(1), ...args], {cwd, env: {...env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1"}, stdio: ["ignore", "pipe", "pipe"]});
        const stdout: Buffer[] = [];
        let stderr = "";
        let timedOut = false;
        child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr!.on("data", (chunk: Buffer) => {
            stderr = (stderr + chunk.toString("utf8")).slice(-2_000);
        });
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS).unref();
        }, TIMEOUT_MS);
        child.on("error", (error) => {
            clearTimeout(timer);
            rejectPromise(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolvePromise({code, stdout: Buffer.concat(stdout).toString("utf8"), stderr, timedOut});
        });
    });
}

/**
 * 内存里的一份 GitHub 数据：单飞，失败时保留上一份并标 `stale`。
 * 每次尝试只在结束时推送一次“github 变了”，开始取时不推：页面收到推送会重取 `/api/github`，而这个 GET 不触发取数，
 * 打开页面的“需要数据”另由页面显式发（`touch`），所以推送与取数不会互相引发（t14 实现审查 B1）。
 */
export class GithubCache {
    private view: GithubView = {state: "idle", at: null, error: null, refreshing: false, prs: [], issues: [], truncated: {prs: false, issues: false}};
    private inflight: Promise<void> | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    /** 上一次尝试结束的时刻，不论成败；`touch()` 按它判断要不要再取。 */
    private attemptedAt: number | null = null;

    constructor(private readonly options: {cwd: string; env: NodeJS.ProcessEnv; hasClients: () => boolean; onChanged: () => void; log: (message: string) => void}) {}

    current(): GithubView {
        return this.view;
    }

    /** 打开页面时：从没取过，或离上一次尝试超过间隔（上次取到了按刷新间隔，没取到按 60 秒），就在后台取一次（不等它）。 */
    touch(): void {
        if (this.inflight) return;
        const wait = this.view.state === "ok" ? GH_REFRESH_MS : GH_RETRY_AFTER_FAILURE_MS;
        if (this.attemptedAt === null || Date.now() - this.attemptedAt >= wait) void this.refresh();
    }

    start(): void {
        this.timer = setInterval(() => {
            if (this.options.hasClients() && this.view.at !== null) void this.refresh();
        }, GH_REFRESH_MS);
        this.timer.unref?.();
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    refresh(): Promise<void> {
        this.inflight ??= this.fetch().finally(() => {
            this.inflight = null;
        });
        return this.inflight;
    }

    /** 一次尝试的结果：记下尝试时刻、推送一次。 */
    private finish(next: Omit<Partial<GithubView>, "refreshing">): void {
        this.attemptedAt = Date.now();
        this.view = {...this.view, ...next, refreshing: false};
        this.options.onChanged();
    }

    private async fetch(): Promise<void> {
        this.view = {...this.view, refreshing: true};
        const resolved = await resolveGh(this.options.env);
        if ("reason" in resolved) return this.finish({state: "unavailable", error: resolved.reason});
        const fail = (error: string) => this.finish({state: this.view.at !== null && (this.view.state === "ok" || this.view.state === "stale") ? "stale" : "error", error});
        let results: [RunResult, RunResult];
        try {
            results = await Promise.all([runGh(resolved.argv, GH_COMMANDS.prs, this.options.cwd, this.options.env), runGh(resolved.argv, GH_COMMANDS.issues, this.options.cwd, this.options.env)]);
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            this.options.log(`起不来 gh：${error.message}`);
            return fail(`起不来 gh：${error.message}`);
        }
        const [prs, issues] = results;
        if (prs.code === GH_AUTH_REQUIRED || issues.code === GH_AUTH_REQUIRED) return this.finish({state: "not_logged_in", error: "gh 没有登录：在终端运行 gh auth login"});
        const bad = [prs, issues].find((result) => result.timedOut || result.code !== 0);
        if (bad) {
            const message = bad.timedOut ? `gh 超过 ${TIMEOUT_MS / 1000} 秒没有回应` : `gh 以 ${bad.code} 退出：${bad.stderr.trim().split("\n").slice(-3).join(" ")}`;
            this.options.log(`取 GitHub 数据失败：${message}`);
            return fail(message);
        }
        try {
            const prList = parsePrs(prs.stdout);
            const issueList = parseIssues(issues.stdout);
            this.finish({state: "ok", at: new Date().toISOString(), error: null, prs: prList, issues: issueList, truncated: {prs: prList.length >= GH_LIMIT, issues: issueList.length >= GH_LIMIT}});
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            this.options.log(`gh 的输出读不懂：${error.message}`);
            fail(`gh 的输出读不懂：${error.message}`);
        }
    }
}
