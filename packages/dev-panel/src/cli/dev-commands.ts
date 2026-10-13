import {NbdevError} from "../core/errors.js";
import {resolveTaskTarget} from "../core/lease-ops.js";
import {locateRepository} from "../core/repo.js";
import {AS_OPTION, shortSession, stringValue, writeCaller, type CommandSpec, type Values} from "./common.js";
import type {DevEvent} from "../dev/dev-ops.js";
import type {CommandOutcome} from "./output.js";

/**
 * 开发服务的三个命令（t14）。`dev start` 是长命令：边跑边按行输出 `READY`、`NOT_READY`、`EXITED`（`--json` 时是同样含义的 JSON 行），
 * 不套一次性的外壳。合同见 docs/cli.md 的“dev”。监管与登记的实现在 `src/dev/`，只在这几个命令里按需导入。
 */

export const DEV_USAGE = `  dev start [--checkout <key|路径>] [--package packages/neuro-book] [--script dev] [--work <W> --task <T>] [--ready-pattern <正则>] [--ready-timeout <秒>] [--grace <秒>] [--as <标签>]
  dev status [--checkout <key|路径>] [--package …] [--script …] [--all] [--wait-ready [--timeout <秒>]]
  dev stop (<runId> | [--checkout <key|路径>] [--package …] [--script …]) [--force] [--grace <秒>] [--as <标签>]`;

const TARGET_OPTIONS = {checkout: {type: "string"}, package: {type: "string"}, script: {type: "string"}} as const;

function seconds(values: Values, name: string, fallbackMs: number): number {
    const text = stringValue(values, name);
    if (text === undefined) return fallbackMs;
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0 || value > 3_600) throw new NbdevError("usage", `--${name} 写 1 到 3600 的秒数：${text}`);
    return Math.round(value * 1_000);
}

function eventLine(event: DevEvent): string {
    switch (event.event) {
    case "ready": return `READY ${event.url} run=${event.runId}${event.reused ? " reused" : ""}${event.owner ? ` owner=${event.owner}` : ""}`;
    case "not_ready": return `NOT_READY ${event.logPath} run=${event.runId}${event.lastStatus !== null ? ` status=${event.lastStatus}` : ""}${event.reused ? " reused" : ""}`;
    case "exited": return `EXITED ${event.signal ?? event.exitCode ?? "?"} run=${event.runId}${event.leftovers > 0 ? ` leftovers=${event.leftovers}` : ""}`;
    }
}

export const DEV_COMMANDS: Record<string, CommandSpec> = {
    "dev start": {
        schema: "nbdev.dev-start/v1",
        positionals: [],
        options: {...TARGET_OPTIONS, work: {type: "string"}, task: {type: "string"}, "ready-pattern": {type: "string"}, "ready-timeout": {type: "string"}, grace: {type: "string"}, ...AS_OPTION},
        async run({io, values}): Promise<CommandOutcome> {
            const {devStart, DEFAULT_GRACE_MS, DEFAULT_READY_TIMEOUT_MS} = await import("../dev/dev-ops.js");
            const workRef = stringValue(values, "work");
            const taskRef = stringValue(values, "task");
            if ((workRef === undefined) !== (taskRef === undefined)) throw new NbdevError("usage", "--work 与 --task 要一起给");
            const context = await locateRepository(io.cwd);
            const task = workRef !== undefined && taskRef !== undefined ? await resolveTaskTarget(context, workRef, taskRef) : null;
            const {caller, warnings} = await writeCaller(io, values);
            const json = values.json === true;
            const result = await devStart(context, io.cwd, {
                checkoutRef: stringValue(values, "checkout") ?? null,
                packageDir: stringValue(values, "package") ?? "packages/neuro-book",
                script: stringValue(values, "script") ?? "dev",
                task,
                readyPattern: stringValue(values, "ready-pattern") ?? null,
                readyTimeoutMs: seconds(values, "ready-timeout", DEFAULT_READY_TIMEOUT_MS),
                graceMs: seconds(values, "grace", DEFAULT_GRACE_MS),
            }, caller, io.env, (event) => io.stdout.write(`${json ? JSON.stringify(event) : eventLine(event)}\n`));
            return {schema: "nbdev.dev-start/v1", data: null, warnings: [...warnings, ...result.warnings], error: null, human: [], streamed: {exitCode: result.exitCode}};
        },
    },
    "dev status": {
        schema: "nbdev.dev-status/v1",
        positionals: [],
        options: {...TARGET_OPTIONS, all: {type: "boolean"}, "wait-ready": {type: "boolean"}, timeout: {type: "string"}},
        async run({io, values}): Promise<CommandOutcome> {
            const {DEFAULT_READY_TIMEOUT_MS, listRuns, resolveDevTarget, waitRunReady} = await import("../dev/dev-ops.js");
            const context = await locateRepository(io.cwd);
            const target = await resolveDevTarget(context, stringValue(values, "checkout") ?? null, stringValue(values, "package") ?? "packages/neuro-book", stringValue(values, "script") ?? "dev", io.cwd);
            if (values["wait-ready"] === true) {
                const run = await waitRunReady(context.mainRoot, target, seconds(values, "timeout", DEFAULT_READY_TIMEOUT_MS));
                return {schema: "nbdev.dev-status/v1", data: {runs: [run]}, warnings: [], error: null, human: [`READY ${run.url} run=${run.runId}`]};
            }
            const {runs, warnings} = await listRuns(context.mainRoot);
            const dayAgo = Date.now() - 24 * 3_600_000;
            const shown = runs
                .filter((run) => values.all === true || run.checkout === target.checkout.root)
                .filter((run) => run.state !== "ended" || Date.parse(run.endedAt ?? run.startedAt) >= dayAgo)
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
            return {
                schema: "nbdev.dev-status/v1",
                data: {runs: shown},
                warnings,
                error: null,
                human: shown.length === 0 ? ["没有经 nbdev 起的服务"] : shown.map((run) => `${run.state}${run.reason ? `（${run.reason}）` : ""}  ${run.runId}  ${run.checkoutKey}:${run.package}:${run.script}  ${run.url ?? "地址未知"}  ${run.startedBy ? shortSession(run.startedBy.key) : "未认出的调用者"}  日志 ${run.logPath}`),
            };
        },
    },
    "dev stop": {
        schema: "nbdev.dev-stop/v1",
        positionals: ["runId"],
        positionalsOptional: true,
        options: {...TARGET_OPTIONS, force: {type: "boolean"}, grace: {type: "string"}, ...AS_OPTION},
        async run({io, positionals, values}): Promise<CommandOutcome> {
            const {DEFAULT_GRACE_MS, devStop, resolveDevTarget} = await import("../dev/dev-ops.js");
            const {assertRunId} = await import("../dev/procs.js");
            const context = await locateRepository(io.cwd);
            const runId = positionals[0] !== undefined ? assertRunId(positionals[0]) : null;
            const target = runId === null ? await resolveDevTarget(context, stringValue(values, "checkout") ?? null, stringValue(values, "package") ?? "packages/neuro-book", stringValue(values, "script") ?? "dev", io.cwd) : null;
            const {caller, warnings} = await writeCaller(io, values);
            const data = await devStop(context.mainRoot, {runId, target, force: values.force === true, graceMs: seconds(values, "grace", DEFAULT_GRACE_MS)}, caller);
            return {
                schema: "nbdev.dev-stop/v1",
                data,
                warnings,
                error: null,
                human: [...data.stopped.map((id) => `已停 ${id}`), ...data.skipped.map((entry) => `${entry.runId} 已结束（${entry.reason}），没有发信号`)],
            };
        },
    },
};
