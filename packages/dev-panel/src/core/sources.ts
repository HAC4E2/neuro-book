import {basename} from "node:path";
import type {Warning} from "./errors.js";
import {gitOutput, splitLines, splitNul} from "./git.js";
import {WORK_ID_PATTERN} from "./ids.js";
import {findWork, isClaimedTask, type Registry} from "./registry.js";
import {MASTER_REF, WORKS_ROOT, type CheckoutInfo} from "./repo.js";

/** 过渡期里一个 Work 的执行 worktree 与其余副本。 */
export type ExecutionCheckout = {chosen: CheckoutInfo; rule: "home" | "name" | "recent"; others: CheckoutInfo[]};

function workIdOfPath(path: string): string | null {
    const segments = path.split("/");
    if (`${segments[0]}/${segments[1]}` !== WORKS_ROOT) return null;
    const workId = segments[2] ?? "";
    return WORK_ID_PATTERN.test(workId) ? workId : null;
}

/**
 * 两份 diff 的交集里，去掉分支上只是留着 `master` 旧版本的路径：分支上的 blob 等于 merge-base 的版本，
 * 或等于 `master` 自 merge-base 以来任一提交里的版本，就是旧副本。t05 的迁移先把记录合进 master、再把分支恢复成
 * master 的版本；之后 master 每改一次，这些路径都会同时出现在两份 diff 里，只有比对 blob 才分得出不是分支改的。
 */
async function withoutStaleCopies(mainRoot: string, head: string, candidates: readonly string[]): Promise<string[]> {
    if (candidates.length === 0) return [];
    const base = (await gitOutput(mainRoot, ["merge-base", MASTER_REF, head], {readOnly: true})).trim();
    const history = await gitOutput(mainRoot, ["log", "--no-renames", "--format=%x00%H", "--name-only", `${base}..${MASTER_REF}`, "--", `${WORKS_ROOT}/`], {readOnly: true});
    const masterCommitsByPath = new Map<string, string[]>();
    for (const chunk of history.split("\0")) {
        const [commit, ...paths] = splitLines(chunk);
        if (!commit) continue;
        for (const path of paths) {
            const commits = masterCommitsByPath.get(path);
            if (commits) commits.push(commit);
            else masterCommitsByPath.set(path, [commit]);
        }
    }
    const queries: Array<{path: string; role: "branch" | "known"}> = [];
    const lines: string[] = [];
    for (const path of candidates) {
        const revisions: Array<[string, "branch" | "known"]> = [[head, "branch"], [base, "known"], ...(masterCommitsByPath.get(path) ?? []).map((commit): [string, "known"] => [commit, "known"])];
        for (const [rev, role] of revisions) {
            queries.push({path, role});
            lines.push(`${rev}:${path}\n`);
        }
    }
    const output = splitLines(await gitOutput(mainRoot, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {readOnly: true, input: lines.join("")}));
    const branchBlob = new Map<string, string>();
    const knownBlobs = new Map<string, Set<string>>();
    for (const [index, query] of queries.entries()) {
        const [oid, type] = (output[index] ?? "").split(" ");
        if (!oid || type !== "blob") continue;
        if (query.role === "branch") branchBlob.set(query.path, oid);
        else {
            const known = knownBlobs.get(query.path) ?? new Set<string>();
            known.add(oid);
            knownBlobs.set(query.path, known);
        }
    }
    return candidates.filter((path) => {
        const blob = branchBlob.get(path);
        return blob === undefined || !knownBlobs.get(path)?.has(blob);
    });
}

/**
 * 判定哪些 Work 的记录还在分支上维护（过渡期，现算不存标记）。
 * 一个路径要同时满足：分支自分出以来新增或改过（`master...HEAD` 的 AM），与当前 `master` 仍不同（`master HEAD`），
 * 而且不是 `master` 某个旧版本的副本（见 `withoutStaleCopies`）。
 * 只有未提交改动的 worktree 不算，只给 `uncommitted_branch_records` 警告。
 */
export async function findBranchRecordChanges(mainRoot: string, checkouts: readonly CheckoutInfo[]): Promise<{changes: Map<string, CheckoutInfo[]>; warnings: Warning[]}> {
    const changes = new Map<string, CheckoutInfo[]>();
    const warnings: Warning[] = [];
    const linked = checkouts.filter((checkout) => !checkout.isMain);
    for (const checkout of linked.filter((candidate) => candidate.prunable)) {
        warnings.push({code: "prunable_worktree", message: `已登记的 worktree 目录不存在，跳过：${checkout.root}`, details: {checkout: checkout.root}});
    }
    const results = await Promise.all(linked.filter((checkout) => !checkout.prunable && checkout.head !== "").map(async (checkout) => {
        const scope = `${WORKS_ROOT}/`;
        const [sinceFork, againstMaster, uncommitted] = await Promise.all([
            gitOutput(mainRoot, ["diff", "--name-only", "-z", "--no-renames", "--diff-filter=AM", `${MASTER_REF}...${checkout.head}`, "--", scope], {readOnly: true}),
            gitOutput(mainRoot, ["diff", "--name-only", "-z", "--no-renames", MASTER_REF, checkout.head, "--", scope], {readOnly: true}),
            gitOutput(checkout.root, ["status", "--porcelain", "-z", "--no-renames", "--", scope], {readOnly: true}),
        ]);
        const differing = new Set(splitNul(againstMaster));
        const candidates = splitNul(sinceFork).filter((path) => workIdOfPath(path) !== null && differing.has(path));
        const committed = new Set<string>();
        for (const path of await withoutStaleCopies(mainRoot, checkout.head, candidates)) committed.add(workIdOfPath(path)!);
        const uncommittedOnly = new Set<string>();
        for (const entry of splitNul(uncommitted)) {
            const workId = workIdOfPath(entry.slice(3));
            if (workId && !committed.has(workId)) uncommittedOnly.add(workId);
        }
        return {checkout, committed, uncommittedOnly};
    }));
    for (const {checkout, committed, uncommittedOnly} of results) {
        for (const workId of committed) {
            const copies = changes.get(workId);
            if (copies) copies.push(checkout);
            else changes.set(workId, [checkout]);
        }
        if (uncommittedOnly.size > 0) {
            warnings.push({
                code: "uncommitted_branch_records",
                message: `worktree 里有未提交的记录改动，没有算作“来自分支”：${checkout.root}`,
                details: {checkout: checkout.root, branch: checkout.branch, workIds: [...uncommittedOnly].sort()},
            });
        }
    }
    return {changes, warnings};
}

/**
 * 认执行 worktree：依次按登记表的 `home` 提示、目录名（以 Work 编号开头且第二段不是 Task 号）、最近改过记录的那一份；
 * 同一条规则命中几份时取最近的，时间相同按 checkout 路径排序。
 */
export async function chooseExecutionCheckout(mainRoot: string, workId: string, candidates: readonly CheckoutInfo[], registry: Registry): Promise<ExecutionCheckout> {
    const sorted = [...candidates].sort((left, right) => left.root < right.root ? -1 : left.root > right.root ? 1 : 0);
    const others = (chosen: CheckoutInfo): CheckoutInfo[] => sorted.filter((candidate) => candidate !== chosen);
    const home = findWork(registry, workId)?.home;
    const homeMatch = home ? sorted.find((candidate) => candidate.root === home) : undefined;
    if (homeMatch) return {chosen: homeMatch, rule: "home", others: others(homeMatch)};
    const number = workId.slice(0, 6);
    const named = sorted.filter((candidate) => {
        const name = basename(candidate.root);
        return name.startsWith(`${number}-`) && !/^w\d{5}-t\d{2,3}-/u.test(name);
    });
    const pool = named.length > 0 ? named : sorted;
    const rule = named.length > 0 ? "name" : "recent";
    if (pool.length === 1) return {chosen: pool[0]!, rule, others: others(pool[0]!)};
    const times = await Promise.all(pool.map(async (candidate) => {
        const output = await gitOutput(mainRoot, ["log", "-1", "--format=%ct", candidate.head, "--", `${WORKS_ROOT}/${workId}`], {readOnly: true});
        return {candidate, time: Number(output.trim() || "0")};
    }));
    // pool 已按路径排好；稳定排序保证时间相同时取路径靠前的。
    times.sort((left, right) => right.time - left.time);
    const chosen = times[0]!.candidate;
    return {chosen, rule, others: others(chosen)};
}

/**
 * 来自分支的 Work 里一个 Task 的来源：在执行 worktree 里存在、且不是经 nbdev 领号新建（登记表 `claimed`）的，算分支；
 * 其余（只在 `master` 上有的，例如已迁的与经 nbdev 新建的）算 `master`。
 */
export function taskSourceInBranchWork(registry: Registry, workId: string, taskId: string, presentInExecution: boolean): "branch" | "master" {
    return presentInExecution && !isClaimedTask(registry, workId, taskId) ? "branch" : "master";
}
