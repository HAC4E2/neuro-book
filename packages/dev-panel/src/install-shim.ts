#!/usr/bin/env bun
/**
 * 写用户级入口 `~/.local/bin/nbdev`：一个只有 exec 的 shim，指向主工作区里的 `packages/dev-panel/src/cli.ts`。
 * 指向主工作区而不是当前 checkout：worktree 分支里可能没有这个命令，或者是旧版本。
 * 用法：bun run --cwd packages/dev-panel install-shim [-- --bin-dir <目录>] [--target <checkout>] [--force] [--json]
 */
import {randomBytes} from "node:crypto";
import {chmod, lstat, mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join, resolve} from "node:path";
import {parseArgs} from "node:util";
import {emit, toNbdevError, type CliIo} from "./cli/output.js";
import {NbdevError, systemErrorCode, type ExitCode} from "./core/errors.js";
import {locateRepository} from "./core/repo.js";

export const SHIM_MARKER = "# nbdev shim (installed by @notnotype/dev-panel)";

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function exists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return false;
        throw error;
    }
}

export async function installShim(argv: readonly string[], io: CliIo): Promise<ExitCode> {
    const json = argv.includes("--json");
    try {
        let values: {"bin-dir"?: string; target?: string; force?: boolean};
        try {
            values = parseArgs({args: [...argv], options: {"bin-dir": {type: "string"}, target: {type: "string"}, force: {type: "boolean"}, json: {type: "boolean"}}, strict: true}).values;
        } catch (error) {
            if (systemErrorCode(error)?.startsWith("ERR_PARSE_ARGS_")) throw new NbdevError("usage", error instanceof Error ? error.message : String(error), {cause: error});
            throw error;
        }
        const target = values.target ? resolve(io.cwd, values.target) : (await locateRepository(import.meta.dirname)).mainRoot;
        const cliPath = join(target, "packages", "dev-panel", "src", "cli.ts");
        if (!await exists(cliPath)) throw new NbdevError("shim_target_not_found", `目标 checkout 里没有 nbdev：${cliPath}`, {details: {target, cliPath}});
        const binDir = resolve(io.cwd, values["bin-dir"] ?? join(homedir(), ".local", "bin"));
        const shimPath = join(binDir, "nbdev");
        const existing = await lstat(shimPath).catch((error: unknown) => {
            if (systemErrorCode(error) === "ENOENT") return null;
            throw error;
        });
        if (existing?.isDirectory()) {
            throw new NbdevError("shim_exists", `${shimPath} 是一个目录，不覆盖`, {details: {shimPath, kind: "directory"}});
        }
        if (existing && !values.force) {
            // 符号链接（含悬空的）不跟随去读；普通文件只有带本脚本的标记才算我们写的。
            const ours = existing.isFile() && (await readFile(shimPath, "utf8")).includes(SHIM_MARKER);
            if (!ours) {
                throw new NbdevError("shim_exists", `${shimPath} 已存在且不是本脚本写的；确认覆盖时加 --force`, {details: {shimPath, kind: existing.isSymbolicLink() ? "symlink" : "file"}});
            }
        }
        await mkdir(binDir, {recursive: true});
        const temporary = `${shimPath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
        // process.execPath 是运行本脚本的 bun；写绝对路径，PATH 里没有 bun 的环境（例如 systemd）也能用。
        // 临时文件独占创建（O_EXCL），同名的符号链接不会被跟随写穿。
        await writeFile(temporary, `#!/bin/sh\n${SHIM_MARKER}\nexec ${shellQuote(process.execPath)} ${shellQuote(cliPath)} "$@"\n`, {encoding: "utf8", flag: "wx", mode: 0o755});
        try {
            await chmod(temporary, 0o755);
            await rename(temporary, shimPath);
        } catch (error) {
            await rm(temporary, {force: true});
            throw error;
        }
        return emit({schema: "nbdev.install-shim/v1", data: {shimPath, cliPath, bun: process.execPath}, warnings: [], error: null, human: [`已写入 ${shimPath} → ${cliPath}`]}, json, io);
    } catch (error) {
        return emit({schema: "nbdev.install-shim/v1", data: null, warnings: [], error: toNbdevError(error, io), human: []}, json, io);
    }
}

if (import.meta.main) {
    process.exitCode = await installShim(process.argv.slice(2), {cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr});
}
