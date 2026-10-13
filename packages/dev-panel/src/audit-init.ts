#!/usr/bin/env bun
/**
 * 初始化审计目录 `${XDG_CONFIG_HOME:-~/.config}/nbdev/`（目录 700、`audit.jsonl` 600、`init.json` 记启用时刻）。
 * 不进 nbdev 的命令面（那是给 Agent 用的）：开发者亲手运行这个脚本，就是授权面板开放通知、文字与按键。
 * 用法：bun run --cwd packages/dev-panel audit-init [-- --json]
 */
import {parseArgs} from "node:util";
import {emit, toNbdevError, type CliIo} from "./cli/output.js";
import {auditPaths, initAudit} from "./core/audit.js";
import {NbdevError, systemErrorCode, type ExitCode} from "./core/errors.js";

export async function auditInit(argv: readonly string[], io: CliIo): Promise<ExitCode> {
    const json = argv.includes("--json");
    try {
        try {
            parseArgs({args: [...argv], options: {json: {type: "boolean"}}, strict: true});
        } catch (error) {
            if (systemErrorCode(error)?.startsWith("ERR_PARSE_ARGS_")) throw new NbdevError("usage", error instanceof Error ? error.message : String(error), {cause: error});
            throw error;
        }
        const paths = auditPaths(io.env);
        const result = await initAudit(paths);
        return emit({schema: "nbdev.audit-init/v1", data: {...paths, ...result}, warnings: [], error: null, human: [result.created ? `已初始化 ${paths.dir}（启用时刻 ${result.initAt}）` : `${paths.dir} 已经初始化过（启用时刻 ${result.initAt}）`]}, json, io);
    } catch (error) {
        return emit({schema: "nbdev.audit-init/v1", data: null, warnings: [], error: toNbdevError(error, io), human: []}, json, io);
    }
}

if (import.meta.main) {
    process.exitCode = await auditInit(process.argv.slice(2), {cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr});
}
