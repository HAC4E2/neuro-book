/**
 * L4 用（`herdr-live.test.ts`）：经 `herdr pane run` 在命名会话的一格 pane 里前台运行，扮成那格 pane 上的 Claude 主进程。
 * 这样它既是 nbdev 的祖先（`CLAUDE_PID`），又在 pane 的前台进程里，与真实会话的 Bash 工具一致。
 * 按计划文件依次以子进程运行 nbdev，每步之后用 herdr 读回 pane 的标签，全部做完后把结果原子地写进输出文件。
 */
import {spawnSync} from "node:child_process";
import {readFileSync, renameSync, writeFileSync} from "node:fs";

type Plan = {
    sessionId: string;
    herdrSession: string;
    paneId: string;
    cwd: string;
    cliPath: string;
    env: Record<string, string>;
    steps: string[][];
    output: string;
};

const plan = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as Plan;
const results = [];
for (const args of plan.steps) {
    const cli = spawnSync(process.execPath, [plan.cliPath, ...args], {
        cwd: plan.cwd,
        env: {...process.env, ...plan.env, CLAUDE_PID: String(process.pid), CLAUDE_CODE_SESSION_ID: plan.sessionId},
        encoding: "utf8",
        timeout: 30_000,
    });
    const pane = spawnSync("herdr", ["--session", plan.herdrSession, "pane", "get", plan.paneId], {encoding: "utf8", timeout: 10_000});
    const tokens = pane.status === 0 ? (JSON.parse(pane.stdout) as {result: {pane: {tokens?: Record<string, string>}}}).result.pane.tokens ?? {} : null;
    results.push({args, exitCode: cli.status, stdout: cli.stdout, stderr: cli.stderr, tokens, paneGetError: pane.status === 0 ? null : pane.stderr});
}
writeFileSync(`${plan.output}.tmp`, JSON.stringify({pid: process.pid, results}));
renameSync(`${plan.output}.tmp`, plan.output);
