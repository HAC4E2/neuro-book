import {parseArgs, type ParseArgsConfig} from "node:util";
import {createHerdrClient, HERDR_CLI_METHODS, HERDR_READ_METHODS, resolveHerdrSocket, type HerdrClient} from "../herdr/client.js";
import type {SessionView} from "../core/activity.js";
import {NbdevError, systemErrorCode, type ExitCode, type Warning} from "../core/errors.js";
import {resolveCaller, type Caller} from "../core/identity.js";
import {listLeases, releaseCallerLeases, takeLease, type LeaseEffects} from "../core/lease-ops.js";
import {createTask, createWork, importRegistry, setRecordStatus, setTaskStatus, type CreateResult, type OperationResult} from "../core/operations.js";
import {locateRepository, type RepoContext} from "../core/repo.js";
import type {Recorded} from "../core/records.js";
import type {RunView} from "../core/runs.js";
import {readProjectStatus, type WorkView} from "../core/status.js";
import type {CommitOutcome} from "../core/transaction.js";
import {emit, toNbdevError, type CliIo, type CommandOutcome} from "./output.js";

export const USAGE = `用法：nbdev <命令> [参数] [--json]

  work new <slug> --title <标题> --goal <目标> --task <slug> [--task-title <标题>] [--issue <n>] [--status <状态>] [--as <标签>]
  task new <workRef> <slug> --title <标题> [--goal <目标>] [--status <状态>] [--as <标签>]
  work status <workRef> <active|done|shelved> [--include-uncommitted]
  task status <workRef> <taskRef> <planned|active|done|shelved> [--include-uncommitted] [--as <标签>]
  lease take <workRef> <taskRef> [--as <标签>]
  lease list [--work <workRef> [--task <taskRef>]] [--all]
  release [<workRef> <taskRef>] [--as <标签>]
  registry import
  status [--work <workRef> [--task <taskRef>]]

workRef 写完整 id 或编号（w00022），taskRef 写完整 id 或编号（t06、t100）。herdr 外的会话用 --as <标签> 标明自己。
合同见 packages/dev-panel/docs/cli.md。`;

type Options = NonNullable<ParseArgsConfig["options"]>;

type CommandSpec = {
    schema: string;
    positionals: string[];
    /** 为真时位置参数可以一个都不给（`release` 不带 Task 时释放调用者的全部租约）。 */
    positionalsOptional?: boolean;
    options: Options;
    run(context: {io: CliIo; positionals: string[]; values: Record<string, string | boolean | undefined>}): Promise<CommandOutcome>;
};

const JSON_OPTION: Options = {json: {type: "boolean"}};
const AS_OPTION: Options = {as: {type: "string"}};
/** status 等只读命令给 herdr 的总时限：herdr 卡住时不能让命令等几十秒。 */
const READ_BUDGET_MS = 2_500;

/** 写命令的调用者：在边界上从调用者的环境解析，核心函数只接收结果。 */
async function writeCaller(io: CliIo, values: Record<string, string | boolean | undefined>): Promise<{herdr: HerdrClient; caller: Caller; warnings: Warning[]}> {
    const herdr = createHerdrClient({socketPath: resolveHerdrSocket(io.env), allow: HERDR_CLI_METHODS});
    const {caller, warnings} = await resolveCaller({env: io.env, as: stringValue(values, "as"), herdr});
    return {herdr, caller, warnings};
}

function readOnlyHerdr(io: CliIo): HerdrClient {
    return createHerdrClient({socketPath: resolveHerdrSocket(io.env), allow: HERDR_READ_METHODS, budgetMs: READ_BUDGET_MS});
}

function ago(iso: string, now: Date): string {
    const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} 小时前` : `${Math.round(hours / 24)} 天前`;
}

function shortSession(key: string): string {
    const [agent, ...rest] = key.split(":");
    const id = rest.join(":");
    return `${agent} ${id.length > 12 && !id.includes("/") ? id.slice(0, 8) : id}`;
}

function callerLine(caller: Caller): string {
    if (caller.kind === "unknown") return `你是：未认出（${caller.reason}）。写命令不会取得租约；herdr 外的会话可以加 --as <标签>`;
    const where = caller.herdr ? `herdr ${caller.herdr.paneId}${caller.herdr.managed ? "" : "，herdr 列表里找不到这个会话"}` : "不在 herdr 里";
    const nested = caller.ref.parentSessionId ? "，嵌套调用，归到外层会话" : "";
    return `你是：${shortSession(caller.ref.key)}（${where}${nested}；子代理与这个会话派出的进程都记在它名下）`;
}

function leaseLines(effects: LeaseEffects): string[] {
    const lines: string[] = [];
    if (effects.lease) lines.push(`租约：${shortSession(effects.lease.session.key)} 在动 ${effects.lease.workId}/${effects.lease.taskId}`);
    if (effects.released.length > 0) lines.push(`释放了 ${effects.released.length} 份租约：${effects.released.map((lease) => shortSession(lease.session.key)).join("、")}`);
    return lines;
}

function runLine(run: RunView, now: Date): string {
    const where = run.unit ? `单元 ${run.unit}` : run.paneId ? `pane ${run.paneId}` : "";
    return `pid ${run.pid}  ${run.command.slice(0, 80)}  （${ago(run.startedAt, now).replace("前", "")}${where ? `，${where}` : ""}）`;
}

function activityLines(sessions: readonly SessionView[], unownedRuns: readonly RunView[], now: Date): string[] {
    const lines: string[] = [];
    if (sessions.length > 0) lines.push("谁在动（临时数据）：");
    for (const session of sessions) {
        const where = session.herdr ? `${session.herdr.paneId}，${session.herdr.status}` : session.managed ? "herdr" : "不在 herdr 里";
        const alive = session.alive === false ? "，会话进程已不在" : "";
        const tasks = session.leases.map((lease) => `${lease.workId.slice(0, 6)}/${lease.taskId.slice(0, lease.taskId.indexOf("-"))}（最近活动 ${ago(lease.lastActivityAt, now)}${lease.stale ? "，淡化" : ""}）`).join("、");
        lines.push(`  ${shortSession(session.key)}（${where}${alive}）${tasks ? ` 在动 ${tasks}` : ""}`);
        for (const run of session.runs) lines.push(`    运行 ${runLine(run, now)}`);
    }
    if (unownedRuns.length > 0) lines.push("无主的运行：", ...unownedRuns.map((run) => `  ${runLine(run, now)}`));
    return lines;
}

function stringValue(values: Record<string, string | boolean | undefined>, name: string): string | undefined {
    const value = values[name];
    return typeof value === "string" ? value : undefined;
}

function requireValue(values: Record<string, string | boolean | undefined>, name: string): string {
    const value = stringValue(values, name);
    if (value === undefined) throw new NbdevError("usage", `缺少 --${name}`);
    return value;
}

function commitLine(commit: CommitOutcome): string {
    if (commit.committed) return commit.viaOtherCommit ? `已在 master（随别的提交 ${commit.sha.slice(0, 9)} 一起入库）` : `已提交 ${commit.sha.slice(0, 9)}（master）`;
    if (commit.reason === "nothing_to_commit") return "内容与 master 相同，无需提交";
    return `未提交（${commit.reason}）：文件已写在主工作区，号已领，不要重跑；处理完 Git 的问题后手动提交 ${commit.writtenPaths.join("、")}`;
}

/** 写命令的结果：提交失败时报 `commit_failed`（退出码 1），`data.commit` 里列出已写的文件。 */
function writeOutcome<T extends object>(schema: string, outcome: OperationResult<T>, summary: string, extra: string[] = []): CommandOutcome {
    const failed = !outcome.commit.committed && outcome.commit.reason !== "nothing_to_commit";
    return {
        schema,
        data: {...outcome.data, commit: outcome.commit},
        warnings: outcome.warnings,
        error: failed ? new NbdevError("commit_failed", "记录已写入主工作区但没有提交", {details: {commit: outcome.commit}}) : null,
        human: [summary, commitLine(outcome.commit), ...extra],
    };
}

function createdSummary(data: CreateResult, what: string): string {
    return `${what} ${data.workId}/${data.taskId}：${data.paths.join("、")}`;
}

function statusLabel(view: {status: Recorded<string>}): string {
    return view.status.origin === "recorded" ? view.status.value : view.status.origin === "invalid" ? "invalid" : "未标";
}

function statusLines(works: readonly WorkView[], detailed: boolean): string[] {
    const lines: string[] = [];
    for (const work of works) {
        const source = work.source === "branch" ? `来自分支 ${work.branch ?? "（分离 HEAD）"}${work.otherCopies.length > 0 ? `，另有 ${work.otherCopies.length} 份副本` : ""}` : "master";
        const counts = Object.entries(work.taskCounts).filter(([, count]) => count > 0).map(([status, count]) => `${status === "unset" ? "未标" : status} ${count}`).join("，");
        lines.push(`${work.workId}  ${statusLabel(work)}  [${source}${work.uncommitted ? "，未提交" : ""}]  ${counts}`);
        if (!detailed) continue;
        if (work.goal.value) lines.push(`  目标${work.goal.origin === "inferred" ? "（推断）" : ""}：${work.goal.value.split("\n")[0]}`);
        for (const task of work.tasks) {
            lines.push(`  ${task.taskId}  ${statusLabel(task)}  [${task.source === "branch" ? `来自分支 ${task.branch ?? ""}` : "master"}${task.uncommitted ? "，未提交" : ""}]  ${task.title ?? ""}`);
        }
    }
    return lines;
}

const COMMANDS: Record<string, CommandSpec> = {
    "work new": {
        schema: "nbdev.work-new/v1",
        positionals: ["slug"],
        options: {title: {type: "string"}, goal: {type: "string"}, task: {type: "string"}, "task-title": {type: "string"}, issue: {type: "string"}, status: {type: "string"}, ...AS_OPTION},
        async run({io, positionals, values}) {
            const issue = stringValue(values, "issue");
            if (issue !== undefined && !/^[1-9][0-9]*$/u.test(issue)) throw new NbdevError("usage", `--issue 必须是正整数：${issue}`);
            const context = await locateRepository(io.cwd);
            const {herdr, caller, warnings} = await writeCaller(io, values);
            const outcome = await createWork(context, {
                slug: positionals[0]!,
                title: requireValue(values, "title"),
                goal: requireValue(values, "goal"),
                taskSlug: requireValue(values, "task"),
                taskTitle: stringValue(values, "task-title"),
                issueNumber: issue === undefined ? undefined : Number(issue),
                taskStatus: stringValue(values, "status"),
            }, {caller, herdr});
            outcome.warnings.unshift(...warnings);
            return writeOutcome("nbdev.work-new/v1", outcome, createdSummary(outcome.data, "已建 Work 与首个 Task"), leaseLines(outcome.data));
        },
    },
    "task new": {
        schema: "nbdev.task-new/v1",
        positionals: ["workRef", "slug"],
        options: {title: {type: "string"}, goal: {type: "string"}, status: {type: "string"}, ...AS_OPTION},
        async run({io, positionals, values}) {
            const context = await locateRepository(io.cwd);
            const {herdr, caller, warnings} = await writeCaller(io, values);
            const outcome = await createTask(context, {
                workRef: positionals[0]!,
                slug: positionals[1]!,
                title: requireValue(values, "title"),
                goal: stringValue(values, "goal"),
                status: stringValue(values, "status"),
            }, {caller, herdr});
            outcome.warnings.unshift(...warnings);
            return writeOutcome("nbdev.task-new/v1", outcome, createdSummary(outcome.data, "已建 Task"), leaseLines(outcome.data));
        },
    },
    "work status": {
        schema: "nbdev.work-status/v1",
        positionals: ["workRef", "status"],
        options: {"include-uncommitted": {type: "boolean"}},
        async run({io, positionals, values}) {
            const outcome = await setRecordStatus(await locateRepository(io.cwd), {
                workRef: positionals[0]!,
                status: positionals[1]!,
                includeUncommitted: values["include-uncommitted"] === true,
            });
            return writeOutcome("nbdev.work-status/v1", outcome, outcome.data.changed ? `${outcome.data.workId} 状态 ${String(outcome.data.previous)} → ${outcome.data.next}` : `${outcome.data.workId} 状态已是 ${outcome.data.next}`);
        },
    },
    "task status": {
        schema: "nbdev.task-status/v1",
        positionals: ["workRef", "taskRef", "status"],
        options: {"include-uncommitted": {type: "boolean"}, ...AS_OPTION},
        async run({io, positionals, values}) {
            const context = await locateRepository(io.cwd);
            const {herdr, caller, warnings} = await writeCaller(io, values);
            const outcome = await setTaskStatus(context, {
                workRef: positionals[0]!,
                taskRef: positionals[1]!,
                status: positionals[2]!,
                includeUncommitted: values["include-uncommitted"] === true,
            }, {caller, herdr});
            outcome.warnings.unshift(...warnings);
            const label = `${outcome.data.workId}/${outcome.data.taskId}`;
            return writeOutcome("nbdev.task-status/v1", outcome, outcome.data.changed ? `${label} 状态 ${String(outcome.data.previous)} → ${outcome.data.next}` : `${label} 状态已是 ${outcome.data.next}`, leaseLines(outcome.data));
        },
    },
    "registry import": {
        schema: "nbdev.registry-import/v1",
        positionals: [],
        options: {},
        async run({io}) {
            const outcome = await importRegistry(await locateRepository(io.cwd));
            return {
                schema: "nbdev.registry-import/v1",
                data: outcome.data,
                warnings: outcome.warnings,
                error: null,
                human: [
                    `补登 ${outcome.data.added.length} 个 id；下一个 Work 号 ${outcome.data.nextWorkNumber}`,
                    ...outcome.data.conflicts.map((conflict) => `撞号 ${conflict.label}${conflict.live ? "（live）" : "（旧副本）"}：${conflict.ids.map((entry) => entry.id).join("、")}`),
                ],
            };
        },
    },
    "lease take": {
        schema: "nbdev.lease-take/v1",
        positionals: ["workRef", "taskRef"],
        options: {...AS_OPTION},
        async run({io, positionals, values}) {
            const context = await locateRepository(io.cwd);
            const {herdr, caller, warnings} = await writeCaller(io, values);
            const outcome = await takeLease(context, {workRef: positionals[0]!, taskRef: positionals[1]!}, {caller, herdr});
            return {schema: "nbdev.lease-take/v1", data: outcome.data, warnings: [...warnings, ...outcome.warnings], error: null, human: leaseLines(outcome.data)};
        },
    },
    "lease list": {
        schema: "nbdev.lease-list/v1",
        positionals: [],
        options: {work: {type: "string"}, task: {type: "string"}, all: {type: "boolean"}},
        async run({io, values}) {
            const workRef = stringValue(values, "work");
            const taskRef = stringValue(values, "task");
            if (taskRef !== undefined && workRef === undefined) throw new NbdevError("usage", "--task 需要同时指定 --work");
            const now = new Date();
            const outcome = await listLeases(await locateRepository(io.cwd), {workRef, taskRef, all: values.all === true}, {herdr: readOnlyHerdr(io), now: () => now});
            return {
                schema: "nbdev.lease-list/v1",
                data: outcome.data,
                warnings: outcome.warnings,
                error: null,
                human: outcome.data.leases.map((lease) => `${lease.state}${lease.stale ? "（淡化）" : ""}  ${shortSession(lease.session.key)}  ${lease.workId}/${lease.taskId}  最近活动 ${ago(lease.lastActivityAt, now)}`),
            };
        },
    },
    release: {
        schema: "nbdev.release/v1",
        positionals: ["workRef", "taskRef"],
        positionalsOptional: true,
        options: {...AS_OPTION},
        async run({io, positionals, values}) {
            const context = await locateRepository(io.cwd);
            const {herdr, caller, warnings} = await writeCaller(io, values);
            const outcome = await releaseCallerLeases(context, {workRef: positionals[0], taskRef: positionals[1]}, {caller, herdr});
            return {schema: "nbdev.release/v1", data: outcome.data, warnings: [...warnings, ...outcome.warnings], error: null, human: leaseLines(outcome.data).length > 0 ? leaseLines(outcome.data) : ["没有要释放的租约"]};
        },
    },
    status: {
        schema: "nbdev.status/v1",
        positionals: [],
        options: {work: {type: "string"}, task: {type: "string"}},
        async run({io, values}) {
            const workRef = stringValue(values, "work");
            const taskRef = stringValue(values, "task");
            if (taskRef !== undefined && workRef === undefined) throw new NbdevError("usage", "--task 需要同时指定 --work");
            const context = await locateRepository(io.cwd);
            const herdr = readOnlyHerdr(io);
            const now = new Date();
            const {caller, warnings: callerWarnings} = await resolveCaller({env: io.env, herdr});
            const {status, warnings} = await readProjectStatus(context, {workRef, taskRef}, {herdr, caller, now, selfPid: process.pid});
            return {
                schema: "nbdev.status/v1",
                data: status,
                warnings: [...callerWarnings, ...warnings],
                error: null,
                human: [
                    callerLine(caller),
                    ...statusLines(status.works, workRef !== undefined),
                    ...activityLines(status.sessions, status.unownedRuns, now),
                    ...status.conflicts.map((conflict) => `撞号 ${conflict.label}${conflict.live ? "（live）" : "（旧副本）"}：${conflict.ids.map((entry) => entry.id).join("、")}`),
                    `下一个 Work 号：${status.nextWorkNumber}`,
                ],
            };
        },
    },
};

function resolveCommand(argv: readonly string[]): {key: string; rest: string[]} | null {
    const two = argv.slice(0, 2).join(" ");
    if (Object.hasOwn(COMMANDS, two)) return {key: two, rest: argv.slice(2)};
    const one = argv[0] ?? "";
    if (Object.hasOwn(COMMANDS, one)) return {key: one, rest: argv.slice(1)};
    return null;
}

/** 命令行入口；返回退出码。 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<ExitCode> {
    const json = argv.includes("--json");
    if (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
        return emit({schema: "nbdev.cli/v1", data: {usage: USAGE}, warnings: [], error: null, human: [USAGE]}, json, io);
    }
    const resolved = resolveCommand(argv);
    if (!resolved) {
        const error = new NbdevError("usage", argv.length === 0 ? "缺少命令" : `未知命令：${argv.slice(0, 2).join(" ")}`);
        if (!json) io.stderr.write(`${USAGE}\n`);
        return emit({schema: "nbdev.cli/v1", data: null, warnings: [], error, human: []}, json, io);
    }
    const spec = COMMANDS[resolved.key]!;
    try {
        let parsed: {values: Record<string, string | boolean | undefined>; positionals: string[]};
        try {
            parsed = parseArgs({args: resolved.rest, options: {...spec.options, ...JSON_OPTION}, allowPositionals: true, strict: true}) as typeof parsed;
        } catch (error) {
            if (systemErrorCode(error)?.startsWith("ERR_PARSE_ARGS_")) throw new NbdevError("usage", error instanceof Error ? error.message : String(error), {cause: error});
            throw error;
        }
        if (parsed.positionals.length !== spec.positionals.length && !(spec.positionalsOptional && parsed.positionals.length === 0)) {
            throw new NbdevError("usage", `nbdev ${resolved.key} 需要 ${spec.positionals.length} 个参数（${spec.positionals.join("、") || "无"}），实际 ${parsed.positionals.length} 个`);
        }
        return emit(await spec.run({io, positionals: parsed.positionals, values: parsed.values}), json, io);
    } catch (error) {
        return emit({schema: spec.schema, data: null, warnings: [], error: toNbdevError(error, io), human: []}, json, io);
    }
}
