import {createHash} from "node:crypto";
import {basename, relative} from "node:path";
import {readFile} from "node:fs/promises";
import {systemErrorCode} from "./errors.js";
import {readSection} from "./frontmatter.js";
import {findTask, findWork} from "./registry.js";
import {taskReadmePath} from "./records.js";
import type {CheckoutInfo} from "./repo.js";
import {chooseExecutionCheckout} from "./sources.js";
import type {TransitionState} from "./status.js";

/**
 * checkout 的 key：面板与产物来源按它指定 checkout，不接受任意路径。主工作区是 `main`，worktree 用目录名；
 * 撞名（`.worktree/` 之外的同名 worktree，或目录名就叫 `main`）时改用路径哈希的前 12 位。
 */
export function checkoutKeys(checkouts: readonly CheckoutInfo[]): Map<string, string> {
    const keys = new Map<string, string>();
    const counts = new Map<string, number>();
    const linked = checkouts.filter((checkout) => !checkout.isMain);
    for (const checkout of linked) counts.set(basename(checkout.root), (counts.get(basename(checkout.root)) ?? 0) + 1);
    for (const checkout of checkouts) {
        if (checkout.isMain) {
            keys.set(checkout.root, "main");
            continue;
        }
        const name = basename(checkout.root);
        const clash = (counts.get(name) ?? 0) > 1 || name === "main" || name.startsWith("h-");
        keys.set(checkout.root, clash ? `h-${createHash("sha256").update(checkout.root).digest("hex").slice(0, 12)}` : name);
    }
    return keys;
}

/**
 * worktree 的目录名是不是这个 Task 的：`<Work 编号>-<Task 编号>-…`（例如 `w00022-t15-ui`）。Task 执行 checkout 的第 2 条规则与
 * checkout 页的“它的 Task”共用这一个判据，两处才对得上。
 */
export function checkoutNamedForTask(root: string, workId: string, taskId: string): boolean {
    return basename(root).startsWith(`${workId.slice(0, 6)}-${taskId.slice(0, taskId.indexOf("-"))}-`);
}

export type ExecutionRule = "readme" | "name" | "home" | "work" | "master";
export type ExecutionCandidate = {key: string; root: string; branch: string | null; rule: ExecutionRule};
export type TaskExecution = {chosen: ExecutionCandidate; candidates: ExecutionCandidate[]};

/** 行内代码里的 token（`…`）：执行位置一节用它写 worktree 路径与分支名。 */
function codeSpans(text: string): string[] {
    return [...text.matchAll(/`([^`\n]+)`/gu)].map((match) => match[1]!.trim());
}

async function readText(path: string): Promise<string | null> {
    try {
        return await readFile(path, "utf8");
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "EISDIR") return null;
        throw error;
    }
}

/**
 * Task 的执行 checkout（代码在哪里改；与“记录从哪里读”不同）。候选依次：
 * 1. README“执行位置”一节里写的 worktree 路径或分支（按出现的先后）；
 * 2. 目录名匹配 `<Work 编号>-<Task 编号>-*` 的 worktree（可能有几份，例如草稿与实现）；
 * 3. 登记表里这个 Task（没有就用 Work）的 `home`；
 * 4. Work 的执行 worktree（过渡期里记录在分支上的 Work）；
 * 5. 主工作区。
 * 同一份 checkout 只按它最先命中的规则列一次；选第一个候选。`recordRoot` 是 Task 记录所在的 checkout（读 README 用）。
 */
export async function resolveTaskExecution(mainRoot: string, transition: TransitionState, workId: string, taskId: string, recordRoot: string): Promise<TaskExecution> {
    const keys = checkoutKeys(transition.checkouts);
    const usable = transition.checkouts.filter((checkout) => !checkout.prunable);
    const candidates: ExecutionCandidate[] = [];
    const add = (checkout: CheckoutInfo | undefined, rule: ExecutionRule) => {
        if (!checkout || candidates.some((candidate) => candidate.root === checkout.root)) return;
        candidates.push({key: keys.get(checkout.root)!, root: checkout.root, branch: checkout.branch, rule});
    };
    const readme = await readText(`${recordRoot}/${taskReadmePath(workId, taskId)}`);
    const section = readme === null ? null : readSection(readme, "执行位置");
    if (section !== null) {
        for (const token of codeSpans(section)) {
            const cleaned = token.replace(/\/+$/u, "");
            add(usable.find((checkout) => !checkout.isMain && (relative(mainRoot, checkout.root) === cleaned || checkout.root === cleaned || checkout.branch === cleaned)), "readme");
        }
    }
    for (const checkout of usable.filter((candidate) => !candidate.isMain && checkoutNamedForTask(candidate.root, workId, taskId)).sort((left, right) => left.root.localeCompare(right.root))) {
        add(checkout, "name");
    }
    const home = findTask(transition.registry, workId, taskId)?.home ?? findWork(transition.registry, workId)?.home ?? null;
    if (home) add(usable.find((checkout) => checkout.root === home), "home");
    const copies = transition.branchChanges.get(workId);
    if (copies) add((await chooseExecutionCheckout(mainRoot, workId, copies, transition.registry)).chosen, "work");
    add(usable.find((checkout) => checkout.isMain), "master");
    return {chosen: candidates[0]!, candidates};
}
