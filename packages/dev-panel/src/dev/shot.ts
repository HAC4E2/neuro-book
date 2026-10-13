import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdir, mkdtemp, readdir, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";
import {NbdevError} from "../core/errors.js";
import {AGENT_LOCAL_ROOT} from "../core/registry.js";
import type {RepoContext} from "../core/repo.js";
import {listRuns, resolveDevTarget} from "./dev-ops.js";

/**
 * `nbdev shot`（t14）：只做薄包装，把三件事交给目标 checkout 自己的 `lab:shot`：
 * - 地址：`--url`，没有就取这个 checkout 上还活着、已就绪的服务的地址；
 * - 输出目录：`.local/agent/works/<W>/tasks/<T>/shots/<UTC 时间>/`，不带 Task 时是 `.local/agent/shots/<UTC 时间>/`；
 * - `TMPDIR`：指到 `/dev/shm/nbdev-shot-<随机>`，跑完删掉。`/tmp` 是带配额的内存盘，Chrome 的临时数据曾把它占满、浏览器崩溃。
 * 不注入浏览器路径：两种 `lab:shot` 缺省用 `channel: "chrome"`（t14 设计审查 S10）。截图逻辑全在 `lab:shot` 里，这里不另写。
 */

export type ShotInput = {checkoutRef: string | null; packageDir: string; url: string | null; task: {workId: string; taskId: string} | null; passthrough: string[]};
export type ShotResult = {url: string; outDir: string; files: string[]; exitCode: number};

const SHM = "/dev/shm";

async function listFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, {recursive: true, withFileTypes: true});
    return entries.filter((entry) => entry.isFile()).map((entry) => relative(dir, join(entry.parentPath, entry.name))).sort();
}

export async function runShot(context: RepoContext, cwd: string, input: ShotInput, env: NodeJS.ProcessEnv): Promise<ShotResult> {
    const target = await resolveDevTarget(context, input.checkoutRef, input.packageDir, "dev", cwd);
    const packageRoot = join(target.checkout.root, target.packageDir);
    const scripts = existsSync(join(packageRoot, "package.json")) ? (JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {scripts?: Record<string, unknown>}).scripts ?? {} : {};
    if (typeof scripts["lab:shot"] !== "string") throw new NbdevError("shot_unavailable", `${packageRoot}/package.json 里没有 lab:shot`, {details: {package: packageRoot}});
    let url = input.url;
    if (url === null) {
        const {runs} = await listRuns(context.mainRoot);
        const alive = runs.filter((run) => run.checkout === target.checkout.root && run.state !== "ended" && run.url && run.readyAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        url = alive[0]?.url ?? null;
    }
    if (url === null) throw new NbdevError("dev_not_running", `${target.key} 上没有经 nbdev 起、已就绪的开发服务：先 nbdev dev start，或用 --url 指定`, {details: {checkout: target.checkout.root}});
    const stamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
    const outDir = input.task
        ? resolve(context.mainRoot, AGENT_LOCAL_ROOT, "works", input.task.workId, "tasks", input.task.taskId, "shots", stamp)
        : resolve(context.mainRoot, AGENT_LOCAL_ROOT, "shots", stamp);
    await mkdir(outDir, {recursive: true});
    const scratch = await mkdtemp(join(existsSync(SHM) ? SHM : tmpdir(), "nbdev-shot-"));
    try {
        const child = spawn(process.execPath, ["run", "lab:shot", "--", "--url", url, "--out", outDir, ...input.passthrough], {cwd: packageRoot, env: {...env, TMPDIR: scratch}, stdio: ["ignore", "pipe", "pipe"]});
        let stderr = "";
        child.stdout!.resume();
        child.stderr!.on("data", (chunk: Buffer) => {
            stderr = (stderr + chunk.toString("utf8")).slice(-4_000);
        });
        const exitCode = await new Promise<number>((done, fail) => {
            child.on("error", fail);
            child.on("close", (code, signal) => done(code ?? (signal ? 128 : 1)));
        });
        const files = await listFiles(outDir);
        if (exitCode !== 0) throw new NbdevError("shot_failed", `lab:shot 以 ${exitCode} 退出：${stderr.trim().split("\n").slice(-10).join("\n")}`, {details: {exitCode, outDir, files}});
        return {url, outDir, files, exitCode};
    } finally {
        await rm(scratch, {recursive: true, force: true});
    }
}
