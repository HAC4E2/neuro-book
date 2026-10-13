import type {Warning} from "../core/errors.js";
import {runGit} from "../core/git.js";
import {MASTER_REF} from "../core/repo.js";
import type {GithubView, PrView} from "./github.js";
import type {PanelState} from "./state.js";

/**
 * 面板“现场”的三页（t14）：“在跑”、checkout、GitHub。合同见 docs/panel.md 的“现场”。
 * checkout 页的未提交与领先落后请求时现算、每个 checkout 留 10 秒：按 HEAD 与 index 的 mtime 缓存会漏掉没 `add` 的改动
 * （面板的 Git 读操作带 `--no-optional-locks`，`git status` 不回写 index，t14 设计审查 I3）。
 */

const CHECKOUT_TTL_MS = 10_000;
const PARALLEL = 4;

/** “在跑”：经 nbdev 起的（登记）、会话的运行、无主的运行；后两块已按登记的 pid 去重（`discoverRuns` 的排除集）。 */
export function runsView(state: PanelState): {data: unknown; warnings: Warning[]} {
    const activity = state.activity.part.value;
    return {
        data: {
            procs: (activity?.procs ?? []).map((run) => ({...run, checkoutKey: state.keyOf(run.checkout) ?? run.checkoutKey})),
            sessions: (activity?.activity.sessions ?? []).filter((session) => session.runs.length > 0).map((session) => ({key: session.key, agent: session.agent, label: session.label, alive: session.alive, runs: session.runs})),
            unownedRuns: activity?.activity.unownedRuns ?? [],
        },
        warnings: activity?.warnings ?? [],
    };
}

type CheckoutStatus = {dirty: number | null; ahead: number | null; behind: number | null; error: string | null; at: string};

export class CheckoutStatusCache {
    private readonly cache = new Map<string, {key: string; status: CheckoutStatus; expires: number}>();

    private async compute(root: string, head: string): Promise<CheckoutStatus> {
        const [status, counts] = await Promise.all([
            runGit(root, ["status", "--porcelain=v1", "-uno"], {readOnly: true}),
            runGit(root, ["rev-list", "--left-right", "--count", `${MASTER_REF}...${head}`], {readOnly: true}),
        ]);
        const at = new Date().toISOString();
        if (status.exitCode !== 0) return {dirty: null, ahead: null, behind: null, error: status.stderr.trim().split("\n")[0] ?? "git status 失败", at};
        const dirty = status.stdout.split("\n").filter((line) => line.trim() !== "").length;
        const match = /^(\d+)\s+(\d+)/u.exec(counts.stdout.trim());
        return {dirty, behind: match ? Number(match[1]) : null, ahead: match ? Number(match[2]) : null, error: null, at};
    }

    /** 各 checkout 的状态：4 路并行，结果按 checkout 留 10 秒（HEAD 变了就重算）。 */
    async statuses(checkouts: ReadonlyArray<{root: string; head: string}>): Promise<Map<string, CheckoutStatus>> {
        const now = Date.now();
        const result = new Map<string, CheckoutStatus>();
        const queue = [...checkouts];
        const worker = async () => {
            for (let next = queue.shift(); next; next = queue.shift()) {
                const cached = this.cache.get(next.root);
                if (cached && cached.key === next.head && cached.expires > now) {
                    result.set(next.root, cached.status);
                    continue;
                }
                const status = await this.compute(next.root, next.head);
                this.cache.set(next.root, {key: next.head, status, expires: Date.now() + CHECKOUT_TTL_MS});
                result.set(next.root, status);
            }
        };
        await Promise.all(Array.from({length: PARALLEL}, worker));
        return result;
    }
}

/** checkout 页：分支、HEAD、是哪个 Work 的执行 worktree，加未提交、领先落后、在跑的服务、是哪些 Task 的 `home`（t14）。 */
export async function checkoutsView(state: PanelState, cache: CheckoutStatusCache): Promise<{data: unknown; warnings: Warning[]}> {
    const records = state.records.part.value;
    const executionOf = new Map<string, string[]>();
    for (const work of records?.records.works ?? []) {
        if (work.source !== "branch") continue;
        executionOf.set(work.checkout, [...(executionOf.get(work.checkout) ?? []), work.workId]);
    }
    const homes = new Map<string, Array<{workId: string; taskId: string}>>();
    for (const work of records?.transition.registry.works ?? []) {
        for (const task of work.tasks) if (task.home) homes.set(task.home, [...(homes.get(task.home) ?? []), {workId: work.workId, taskId: task.taskId}]);
    }
    const procs = state.activity.part.value?.procs ?? [];
    const checkouts = state.checkouts.filter((checkout) => !checkout.prunable);
    const statuses = await cache.statuses(checkouts);
    return {
        data: {
            checkouts: checkouts.map((checkout) => ({
                key: state.keyOf(checkout.root)!,
                root: checkout.root,
                branch: checkout.branch,
                head: checkout.head,
                isMain: checkout.isMain,
                executionOf: executionOf.get(checkout.root) ?? [],
                homeOf: homes.get(checkout.root) ?? [],
                runs: procs.filter((run) => run.checkout === checkout.root && run.state !== "ended").map((run) => ({runId: run.runId, package: run.package, script: run.script, state: run.state, url: run.url})),
                ...statuses.get(checkout.root)!,
            })),
        },
        warnings: [],
    };
}

/** 分支名 `<type>/<Work 编号>-<Task 编号>-…` 解析成面板里的 Task（找得到才给链接）。 */
function taskOfBranch(state: PanelState, branch: string): {workId: string; taskId: string} | null {
    const match = /^[a-z]+\/(w\d{5})-(t\d{2,3})-/u.exec(branch);
    if (!match) return null;
    for (const work of state.records.part.value?.records.works ?? []) {
        if (!work.workId.startsWith(`${match[1]}-`)) continue;
        const task = work.tasks.find((entry) => entry.taskId.startsWith(`${match[2]}-`));
        if (task) return {workId: work.workId, taskId: task.taskId};
    }
    return null;
}

export function githubView(state: PanelState, view: GithubView): {data: unknown; warnings: Warning[]} {
    return {data: {...view, prs: view.prs.map((pr: PrView) => ({...pr, task: taskOfBranch(state, pr.branch)}))}, warnings: []};
}
