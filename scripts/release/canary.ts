#!/usr/bin/env bun
import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

import {Command} from "commander";

import {run, runCapture} from "nbook/scripts/utils/process.mjs";

type CanaryOptions = {
    allowDirty: boolean;
    draft: boolean;
    dryRun: boolean;
    push: boolean;
    repo: string;
    tag?: string;
    target?: string;
    watch: boolean;
    yes: boolean;
};

type ReleaseNotesInput = {
    packageVersion: string;
    shortHead: string;
    tag: string;
    target: string;
};

type WorkflowRun = {
    databaseId?: number;
    displayTitle?: string;
    headSha?: string;
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_REPO = "notnotype/neuro-book";
const RELEASE_WORKFLOW = "release-container.yml";

const options = parseOptions();

/** Canary release 脚本主流程。 */
async function main(): Promise<void> {
    process.chdir(REPO_ROOT);

    const packageVersion = await readPackageVersion();
    const branch = await currentBranch();
    const head = (await runCapture("git", ["rev-parse", "HEAD"], {cwd: REPO_ROOT})).trim();
    const shortHead = (await runCapture("git", ["rev-parse", "--short", "HEAD"], {cwd: REPO_ROOT})).trim();
    const tag = options.tag ?? defaultCanaryTag(packageVersion, shortHead);
    const target = options.target ?? head;

    await assertGhAvailable();
    await assertReleaseDoesNotExist(tag);
    await assertGitTagDoesNotExist(tag);
    if (!options.allowDirty) {
        await assertCleanTrackedWorktree();
    }
    if (options.push) {
        await pushCurrentHead(branch);
    } else if (!options.target && !options.dryRun) {
        await assertCurrentHeadPushed(branch, head);
    }

    const notes = await releaseNotes({
        tag,
        target,
        packageVersion,
        shortHead,
    });
    const ghArgs = [
        "release",
        "create",
        tag,
        "--repo",
        options.repo,
        "--target",
        target,
        "--title",
        `NeuroBook ${tag}`,
        "--notes",
        notes,
        "--prerelease",
    ];
    if (options.draft) {
        ghArgs.push("--draft");
    }

    if (options.dryRun) {
        console.log(`tag: ${tag}`);
        console.log(`target: ${target}`);
        console.log(`repo: ${options.repo}`);
        if (!options.target) {
            console.log("note: dry-run 未检查 HEAD 是否已推送；真实 release 会检查，或可加 --push。");
        }
        console.log(`command: gh ${ghArgs.map(shellQuote).join(" ")}`);
        return;
    }

    if (!options.yes) {
        throw new Error("即将创建远端 canary prerelease。确认执行请加 --yes；预览请加 --dry-run。");
    }

    await run("gh", ghArgs, {cwd: REPO_ROOT});
    console.log(`Created canary release: ${tag}`);

    if (options.watch && !options.draft) {
        await watchReleaseWorkflow({head, tag});
    }
}

/** 用 commander 解析 CLI 参数。 */
function parseOptions(): CanaryOptions {
    const program = new Command()
        .name("release:canary")
        .description("Create a NeuroBook canary prerelease from the current repository state.")
        .allowExcessArguments(false)
        .showHelpAfterError("(使用 --help 查看可用参数)")
        .option("--allow-dirty", "允许 tracked worktree 不干净。真实发布通常不建议使用。", false)
        .option("--draft", "创建 draft release。draft 不会等待 release workflow。", false)
        .option("--dry-run", "只打印将执行的 gh release create 命令。", false)
        .option("--push", "发布前把当前 HEAD 推送到当前分支。", false)
        .option("--repo <repo>", "GitHub repository，例如 owner/name。", process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO)
        .option("--tag <tag>", "指定 canary tag。默认使用下一 patch 版本、UTC 时间戳和短 SHA。")
        .option("--target <commit>", "指定 release target commit。默认使用当前 HEAD。")
        .option("--watch", "等待 release workflow 完成。", true)
        .option("--no-watch", "创建 release 后不等待 release workflow。")
        .option("-y, --yes", "确认创建远端 canary prerelease。", false);

    program.parse(process.argv);

    return program.opts<CanaryOptions>();
}

/** 读取 package.json 的版本号。 */
async function readPackageVersion(): Promise<string> {
    const packageJson = JSON.parse(await readFile(resolve(REPO_ROOT, "package.json"), "utf8")) as {version?: unknown};
    return String(packageJson.version);
}

/** 根据 package 版本和短 SHA 生成默认 canary tag。 */
function defaultCanaryTag(packageVersion: string, shortHead: string): string {
    const nextPatch = nextPatchVersion(packageVersion);
    const stamp = new Date()
        .toISOString()
        .replace(/[-:]/gu, "")
        .replace(/\.\d{3}Z$/u, "Z")
        .replace("T", ".");
    return `v${nextPatch}-canary.${stamp}.${shortHead}`;
}

/** 把 semver patch 版本加一，忽略已有 prerelease 后缀。 */
function nextPatchVersion(version: string): string {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/u.exec(version);
    if (!match) {
        throw new Error(`package.json version 不是 semver patch 形式：${version}`);
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    return `${major}.${minor}.${patch + 1}`;
}

/** 返回当前命名分支。 */
async function currentBranch(): Promise<string> {
    const branch = (await runCapture("git", ["branch", "--show-current"], {cwd: REPO_ROOT})).trim();
    if (!branch) {
        throw new Error("当前不是命名分支。请切到 release 分支，或用 --target 指定已推送 commit。");
    }
    return branch;
}

/** 检查 GitHub CLI 可用且已登录。 */
async function assertGhAvailable(): Promise<void> {
    await runCapture("gh", ["--version"], {cwd: REPO_ROOT});
    await runCapture("gh", ["auth", "status"], {cwd: REPO_ROOT});
}

/** 检查远端 GitHub release 尚不存在。 */
async function assertReleaseDoesNotExist(tag: string): Promise<void> {
    try {
        await runCapture("gh", ["release", "view", tag, "--repo", options.repo], {cwd: REPO_ROOT});
    } catch {
        return;
    }
    throw new Error(`GitHub release 已存在：${tag}`);
}

/** 检查本地和远端 git tag 尚不存在。 */
async function assertGitTagDoesNotExist(tag: string): Promise<void> {
    const localTag = await runCapture("git", ["tag", "--list", tag], {cwd: REPO_ROOT});
    if (localTag.trim()) {
        throw new Error(`本地 tag 已存在：${tag}`);
    }
    const remoteTag = await runCapture("git", ["ls-remote", "--tags", "origin", tag], {cwd: REPO_ROOT});
    if (remoteTag.trim()) {
        throw new Error(`远端 tag 已存在：${tag}`);
    }
}

/** 默认发布前要求 tracked worktree 干净。 */
async function assertCleanTrackedWorktree(): Promise<void> {
    const status = await runCapture("git", ["status", "--porcelain", "--untracked-files=no"], {cwd: REPO_ROOT});
    if (status.trim()) {
        throw new Error(`tracked worktree 不干净，停止 release：\n${status.trim()}\n先提交或 stash，或仅本地预览时使用 --allow-dirty --dry-run。`);
    }
}

/** 把当前 HEAD 推送到同名远端分支。 */
async function pushCurrentHead(branch: string): Promise<void> {
    await run("git", ["push", "origin", `HEAD:${branch}`], {cwd: REPO_ROOT});
}

/** 真实发布前确认当前 HEAD 已包含在远端分支。 */
async function assertCurrentHeadPushed(branch: string, head: string): Promise<void> {
    await run("git", ["fetch", "origin", branch], {cwd: REPO_ROOT});
    const remoteRef = `origin/${branch}`;
    const remoteExists = await runCapture("git", ["rev-parse", "--verify", remoteRef], {cwd: REPO_ROOT})
        .then(() => true)
        .catch(() => false);
    if (!remoteExists) {
        throw new Error(`远端分支不存在：${remoteRef}。请先 push，或运行 release 脚本时加 --push。`);
    }
    const containsHead = await runCapture("git", ["merge-base", "--is-ancestor", head, remoteRef], {cwd: REPO_ROOT})
        .then(() => true)
        .catch(() => false);
    if (!containsHead) {
        throw new Error(`当前 HEAD 尚未包含在 ${remoteRef}。请先 push，或运行 release 脚本时加 --push。`);
    }
}

/** 生成 GitHub release notes 文本。 */
async function releaseNotes(input: ReleaseNotesInput): Promise<string> {
    const previousTag = await runCapture("git", ["describe", "--tags", "--abbrev=0", `${input.target}^`], {cwd: REPO_ROOT})
        .then((value: string) => value.trim())
        .catch(() => "");
    const compareLine = previousTag
        ? `Compare: https://github.com/${options.repo}/compare/${previousTag}...${input.tag}`
        : "";
    return [
        "Canary build for early validation.",
        "",
        `- Tag: ${input.tag}`,
        `- Commit: ${input.target}`,
        `- Package version: ${input.packageVersion}`,
        compareLine ? `- ${compareLine}` : "",
        "",
        "Windows portable and container images are produced by the release workflow.",
    ].filter(Boolean).join("\n");
}

/** 等待 GitHub release workflow 完成。 */
async function watchReleaseWorkflow({head, tag}: {head: string; tag: string}): Promise<void> {
    const runId = await findWorkflowRun({head, tag});
    if (!runId) {
        throw new Error(`未找到 ${RELEASE_WORKFLOW} 的 release run。可稍后手动查看 GitHub Actions。`);
    }
    await run("gh", ["run", "watch", runId, "--repo", options.repo, "--exit-status"], {cwd: REPO_ROOT});
}

/** 轮询查找 release 事件触发出的 workflow run。 */
async function findWorkflowRun({head, tag}: {head: string; tag: string}): Promise<string | null> {
    for (let attempt = 0; attempt < 18; attempt += 1) {
        const output = await runCapture("gh", [
            "run",
            "list",
            "--repo",
            options.repo,
            "--workflow",
            RELEASE_WORKFLOW,
            "--event",
            "release",
            "--limit",
            "10",
            "--json",
            "databaseId,headSha,displayTitle,status,createdAt",
        ], {cwd: REPO_ROOT});
        const runs = JSON.parse(output) as WorkflowRun[];
        const match = runs.find((item) => item.headSha === head || item.displayTitle?.includes(tag));
        if (match?.databaseId) {
            return String(match.databaseId);
        }
        await sleep(10_000);
    }
    return null;
}

/** 等待指定毫秒数。 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** 返回适合展示在 shell 命令中的参数文本。 */
function shellQuote(value: string): string {
    return /^[a-zA-Z0-9_./:=@-]+$/u.test(value)
        ? value
        : JSON.stringify(value);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
