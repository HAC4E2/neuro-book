#!/usr/bin/env bun
/**
 * nbdev 命令行入口。用户级 shim（`install-shim` 写入）以主工作区里的这份文件运行；
 * cwd 保持调用者所在的位置，命令行自己找到主工作区。
 */
import {runCli} from "./cli/main.js";

process.exitCode = await runCli(process.argv.slice(2), {cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr});
