import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {TerminalTools} from "../src/server/terminal-stream.js";

/**
 * L3 用的终端工具：`herdr` 是调用 `tests/fake-herdr-cli.ts` 的 sh 包装，`setpriv` 用本机的。假命令行的状态目录在 socket 旁边的
 * `fake-cli/`（面板只给子进程三个环境变量），`socketDir` 给了就放在那里（与 `tests/fake-herdr.ts` 的 socket 同一个目录）。
 */
const roots: string[] = [];

export async function fakeTerminalTools(name: string, terminals: Record<string, {mode?: string; reasons?: string}>, socketDir?: string): Promise<{tools: TerminalTools; state: string}> {
    const root = await createTestTmpRoot(`dev-panel-${name}`, `dev-panel ${name}`);
    roots.push(root);
    const bin = join(root, "bin");
    await mkdir(bin, {recursive: true});
    await writeFile(join(bin, "herdr"), `#!/bin/sh\nexec '${process.execPath}' '${join(import.meta.dirname, "fake-herdr-cli.ts")}' "$@"\n`, {mode: 0o755});
    const socketPath = join(socketDir ?? root, "herdr.sock");
    const state = join(dirname(socketPath), "fake-cli");
    await mkdir(state, {recursive: true});
    await writeFile(join(state, "config.json"), JSON.stringify({terminals}));
    return {tools: {herdrBin: join(bin, "herdr"), setprivBin: "/usr/bin/setpriv", setsidBin: "/usr/bin/setsid", socketPath}, state};
}

export async function cleanupFakeTerminals(): Promise<void> {
    for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
}
