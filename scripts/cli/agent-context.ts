#!/usr/bin/env bun
import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
    CANONICAL_ROLES,
    defaultRepoRoot,
    git,
    gitBranch,
    gitRevision,
    governanceRoots,
    resolveTaskReadmePath,
} from "#scripts/ci/agent-governance-contract";

const args = process.argv.slice(2);
const repoArgument = args.indexOf("--repo-root");
const roleArgument = args.indexOf("--role");
const taskArgument = args.indexOf("--task");
const repoRoot = resolve(repoArgument >= 0 ? args[repoArgument + 1] ?? "" : defaultRepoRoot(import.meta.url));
const role = roleArgument >= 0 ? args[roleArgument + 1] : undefined;
const task = taskArgument >= 0 ? args[taskArgument + 1] : undefined;
const failures: string[] = [];

if (role && !CANONICAL_ROLES.includes(role as typeof CANONICAL_ROLES[number])) {
    failures.push(`未知角色：${role}`);
}
const numericTaskMatch = task ? /^(\d{2,5})-[A-Za-z0-9][A-Za-z0-9._-]*$/u.exec(task) : null;
const validTask = task === undefined
    || /^archived\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(task)
    || (numericTaskMatch !== null && Number.parseInt(numericTaskMatch[1]!, 10) > 0);
if (!validTask) failures.push(`Task 标识格式无效：${task}`);

function findTaskReadmePath(repoRoot: string, task: string): {path: string | null; checkedRoots: string[]; failures: string[]} {
    return resolveTaskReadmePath(repoRoot, task);
}

const taskResolution = task ? findTaskReadmePath(repoRoot, task) : {path: null, checkedRoots: [], failures: []};
failures.push(...taskResolution.failures);
if (task && !taskResolution.path) failures.push(`Task README 不存在：${task}；已检查 root：${taskResolution.checkedRoots.join(", ") || "无"}`);

const statusText = existsSync(resolve(repoRoot, "PROJECT-STATUS.md"))
    ? readFileSync(resolve(repoRoot, "PROJECT-STATUS.md"), "utf8")
    : "";
const statusLine = statusText.split(/\r?\n/u).find((line) => line.startsWith("NeuroBook 当前处于"))
    ?? statusText.split(/\r?\n/u).find((line) => line.startsWith(">"))
    ?? "PROJECT-STATUS.md 未提供一句话结论";
const roots = governanceRoots(repoRoot);
const worktreePath = git(repoRoot, ["rev-parse", "--show-toplevel"]);
const report = {
    schema: "nbook.governance-context/v1",
    repoRoot,
    revision: gitRevision(repoRoot),
    branch: gitBranch(repoRoot),
    worktree: worktreePath,
    role: role ?? null,
    task: task ?? null,
    taskReadme: taskResolution.path,
    taskReadmeCheckedRoots: taskResolution.checkedRoots,
    status: statusLine.replace(/^>\s*/u, "").trim(),
    roots,
    trackedChanges: git(repoRoot, ["status", "--short"]),
    failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exitCode = 1;
