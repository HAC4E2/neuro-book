import type {ParseArgsConfig} from "node:util";
import {createHerdrClient, HERDR_CLI_METHODS, HERDR_READ_METHODS, resolveHerdrSocket, type HerdrClient} from "../herdr/client.js";
import {NbdevError, type Warning} from "../core/errors.js";
import {resolveCaller, type Caller} from "../core/identity.js";
import type {LeaseEffects} from "../core/lease-ops.js";
import type {OperationResult} from "../core/operations.js";
import type {CommitOutcome} from "../core/transaction.js";
import type {CliIo, CommandOutcome} from "./output.js";

/** 命令行各命令共用的类型与小工具（命令定义分在 main.ts 与 artifact-commands.ts）。 */

export type Options = NonNullable<ParseArgsConfig["options"]>;

export type CommandSpec = {
    schema: string;
    positionals: string[];
    /** 为真时位置参数可以一个都不给（`release` 不带 Task 时释放调用者的全部租约）。 */
    positionalsOptional?: boolean;
    /** 位置参数个数的范围（`answers` 可以给 0 到 3 个）；给了它就不看 `positionals` 的个数。 */
    positionalsRange?: [number, number];
    options: Options;
    run(context: {io: CliIo; positionals: string[]; values: Values}): Promise<CommandOutcome>;
};

export const JSON_OPTION: Options = {json: {type: "boolean"}};

export const AS_OPTION: Options = {as: {type: "string"}};

/** status 等只读命令给 herdr 的总时限：herdr 卡住时不能让命令等几十秒。 */
export const READ_BUDGET_MS = 2_500;

/** 写命令的调用者：在边界上从调用者的环境解析，核心函数只接收结果。 */
export async function writeCaller(io: CliIo, values: Values): Promise<{herdr: HerdrClient; caller: Caller; warnings: Warning[]}> {
    const herdr = createHerdrClient({socketPath: resolveHerdrSocket(io.env), allow: HERDR_CLI_METHODS, memoizeAvailability: true});
    const {caller, warnings} = await resolveCaller({env: io.env, as: stringValue(values, "as"), herdr});
    return {herdr, caller, warnings};
}

export function readOnlyHerdr(io: CliIo): HerdrClient {
    return createHerdrClient({socketPath: resolveHerdrSocket(io.env), allow: HERDR_READ_METHODS, budgetMs: READ_BUDGET_MS, memoizeAvailability: true, memoizePanes: true});
}

export function ago(iso: string, now: Date): string {
    const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} 小时前` : `${Math.round(hours / 24)} 天前`;
}

export function shortSession(key: string): string {
    const [agent, ...rest] = key.split(":");
    const id = rest.join(":");
    return `${agent} ${id.length > 12 && !id.includes("/") ? id.slice(0, 8) : id}`;
}

export function leaseLines(effects: LeaseEffects): string[] {
    const lines: string[] = [];
    if (effects.lease) lines.push(`租约：${shortSession(effects.lease.session.key)} 在动 ${effects.lease.workId}/${effects.lease.taskId}`);
    if (effects.released.length > 0) lines.push(`释放了 ${effects.released.length} 份租约：${effects.released.map((lease) => shortSession(lease.session.key)).join("、")}`);
    return lines;
}

export function stringValue(values: Values, name: string): string | undefined {
    const value = values[name];
    return typeof value === "string" ? value : undefined;
}

export function requireValue(values: Values, name: string): string {
    const value = stringValue(values, name);
    if (value === undefined) throw new NbdevError("usage", `缺少 --${name}`);
    return value;
}

/** `failureHint` 说明提交失败时为什么不要直接重跑（缺省是领号命令的说法）。 */
export function commitLine(commit: CommitOutcome, failureHint = "号已领，不要重跑"): string {
    if (commit.committed) return commit.viaOtherCommit ? `已在 master（随别的提交 ${commit.sha.slice(0, 9)} 一起入库）` : `已提交 ${commit.sha.slice(0, 9)}（master）`;
    if (commit.reason === "nothing_to_commit") return "内容与 master 相同，无需提交";
    return `未提交（${commit.reason}）：文件已写在主工作区，${failureHint}；处理完 Git 的问题后手动提交 ${commit.writtenPaths.join("、")}`;
}

/** 写命令的结果：提交失败时报 `commit_failed`（退出码 1），`data.commit` 里列出已写的文件。 */
export function writeOutcome<T extends object>(schema: string, outcome: OperationResult<T>, summary: string, extra: string[] = [], failureHint?: string): CommandOutcome {
    const failed = !outcome.commit.committed && outcome.commit.reason !== "nothing_to_commit";
    return {
        schema,
        data: {...outcome.data, commit: outcome.commit},
        warnings: outcome.warnings,
        error: failed ? new NbdevError("commit_failed", "记录已写入主工作区但没有提交", {details: {commit: outcome.commit}}) : null,
        human: [summary, commitLine(outcome.commit, failureHint), ...extra],
    };
}

export type Values = Record<string, string | boolean | string[] | undefined>;

/** `multiple: true` 的选项：没给为空数组。 */
export function listValue(values: Values, name: string): string[] {
    const value = values[name];
    return Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
}
