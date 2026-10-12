import {createHash, randomBytes} from "node:crypto";
import {link, lstat, mkdir, readFile, rename, rm, unlink, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {isNbdevError, NbdevError, systemErrorCode, type Warning} from "./errors.js";
import {gitOutput, runGit, splitLines, splitNul, type GitResult} from "./git.js";
import {acquireRecordsLock, agentPaths, DEFAULT_LOCK_WAIT_MS, prepareAgentDirectories} from "./lock.js";
import {claimTask, claimWork, importScanned, readRegistry, writeRegistry, type Registry} from "./registry.js";
import {assertMainWritable, listCheckouts, WORKS_ROOT, type CheckoutInfo, type RepoContext} from "./repo.js";
import {scannedIds, scanNumbers, type NumberScan} from "./scan.js";

/** 持锁者等 index.lock 等 Git 锁的预算。 */
export const DEFAULT_GIT_LOCK_WAIT_MS = 10_000;

export type CommitOutcome =
    | {committed: true; sha: string; paths: string[]; viaOtherCommit: boolean}
    | {committed: false; reason: "nothing_to_commit"; paths: string[]}
    | {committed: false; reason: "git_lock_timeout" | "git_failed"; writtenPaths: string[]; detail: string};

export type TransactionOptions = {
    now?: () => Date;
    lockWaitMs?: number;
    gitLockWaitMs?: number;
};

export type WriteTx = {
    readonly context: RepoContext;
    readonly now: Date;
    readonly registry: Registry;
    readonly checkouts: readonly CheckoutInfo[];
    /** 本事务扫描时补登为 `imported` 的 id。 */
    readonly imported: readonly string[];
    /** 同一事务内只扫一次；顺带把登记表里没有的号补登为 `imported`。 */
    scan(): Promise<NumberScan>;
    claimWork(workId: string): void;
    claimTask(workId: string, taskId: string): void;
    /** 新目录：落位时整体改名到位，目标必须不存在。`files` 的键是相对目标目录的路径。 */
    createDirectory(targetDir: string, files: Readonly<Record<string, string>>): void;
    /** 新文件：落位时独占创建（先写临时文件，再 link 到目标）。 */
    createFile(target: string, content: string): void;
    /** 改已有文件：落位前重读，sha256 与 `expectedHash` 不同就报 `hash_mismatch`。 */
    replaceFile(target: string, content: string, expectedHash: string): void;
    /** 调用方已写好的现有文件，一起提交。 */
    includePaths(paths: readonly string[]): void;
    warn(warning: Warning): void;
};

export type TransactionResult<T> = {result: T; commit: CommitOutcome; warnings: Warning[]};

type Operation =
    | {kind: "directory"; target: string; files: Readonly<Record<string, string>>}
    | {kind: "file"; target: string; content: string}
    | {kind: "replace"; target: string; content: string; expectedHash: string};

export function sha256(text: string | Buffer): string {
    return createHash("sha256").update(text).digest("hex");
}

/** 目标必须在 `<主工作区>/.agents/works/` 下，不含 `..`，路径上任何一级都不能是符号链接。 */
function normalizeRecordPath(path: string): string {
    const normalized = path.replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (!normalized.startsWith(`${WORKS_ROOT}/`) || segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment === ".git")) {
        throw new NbdevError("unsafe_path", `只能写 ${WORKS_ROOT}/ 下的记录：${path}`, {details: {path}});
    }
    return normalized;
}

async function assertNoSymlinkOnPath(mainRoot: string, relativePath: string): Promise<void> {
    const segments = relativePath.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
        const partial = segments.slice(0, index).join("/");
        let stats;
        try {
            stats = await lstat(resolve(mainRoot, partial));
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") return;
            throw error;
        }
        if (stats.isSymbolicLink()) throw new NbdevError("unsafe_path", `记录路径经过符号链接：${partial}`, {details: {path: relativePath, symlink: partial}});
    }
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return false;
        throw error;
    }
}

function operationPaths(operation: Operation): string[] {
    if (operation.kind === "directory") return Object.keys(operation.files).map((file) => `${operation.target}/${file}`);
    return [operation.target];
}

/** 在动第一个目标之前查完全部冲突：路径护栏、目标已存在、哈希不一致。 */
async function validateOperations(mainRoot: string, operations: readonly Operation[], included: readonly string[]): Promise<void> {
    for (const operation of operations) {
        await assertNoSymlinkOnPath(mainRoot, operation.target);
        const absolute = resolve(mainRoot, operation.target);
        if (operation.kind === "replace") {
            const current = await readFile(absolute).catch((error: unknown) => {
                if (systemErrorCode(error) === "ENOENT") throw new NbdevError("target_missing", `要改的文件不存在：${operation.target}`, {details: {path: operation.target}});
                throw error;
            });
            const actual = sha256(current);
            if (actual !== operation.expectedHash) {
                throw new NbdevError("hash_mismatch", `文件在读取之后被改过：${operation.target}`, {details: {path: operation.target, expected: operation.expectedHash, actual}});
            }
        } else if (await pathExists(absolute)) {
            throw new NbdevError("target_exists", `目标已存在：${operation.target}`, {details: {path: operation.target}});
        }
    }
    for (const path of included) {
        await assertNoSymlinkOnPath(mainRoot, path);
        if (!await pathExists(resolve(mainRoot, path))) throw new NbdevError("target_missing", `要一起提交的文件不存在：${path}`, {details: {path}});
    }
}

async function stageOperations(txDir: string, operations: readonly Operation[]): Promise<string[]> {
    await mkdir(txDir, {recursive: true});
    const staged: string[] = [];
    for (const [index, operation] of operations.entries()) {
        const stagedPath = join(txDir, String(index));
        if (operation.kind === "directory") {
            for (const [file, content] of Object.entries(operation.files)) {
                const path = join(stagedPath, file);
                await mkdir(dirname(path), {recursive: true});
                await writeFile(path, content, {encoding: "utf8", flag: "wx"});
            }
        } else {
            await writeFile(stagedPath, operation.content, {encoding: "utf8", flag: "wx"});
        }
        staged.push(stagedPath);
    }
    return staged;
}

async function applyOperation(mainRoot: string, operation: Operation, stagedPath: string): Promise<void> {
    const absolute = resolve(mainRoot, operation.target);
    await mkdir(dirname(absolute), {recursive: true});
    if (operation.kind === "directory") {
        // Linux 的 rename 能覆盖空目录，所以落位前再查一次；检查与改名之间只剩不经锁的手工建目录。
        if (await pathExists(absolute)) throw new NbdevError("target_exists", `目标已存在：${operation.target}`, {details: {path: operation.target}});
        await rename(stagedPath, absolute);
    } else if (operation.kind === "file") {
        try {
            await link(stagedPath, absolute);
        } catch (error) {
            if (systemErrorCode(error) === "EEXIST") throw new NbdevError("target_exists", `目标已存在：${operation.target}`, {details: {path: operation.target}});
            throw error;
        }
        await unlink(stagedPath);
    } else {
        const actual = sha256(await readFile(absolute));
        if (actual !== operation.expectedHash) {
            throw new NbdevError("hash_mismatch", `文件在读取之后被改过：${operation.target}`, {details: {path: operation.target, expected: operation.expectedHash, actual}});
        }
        await rename(stagedPath, absolute);
    }
}

async function retryOnGitLock(mainRoot: string, args: readonly string[], deadline: number): Promise<GitResult> {
    for (;;) {
        const result = await runGit(mainRoot, args);
        // 128 多半是 index.lock 等 Git 锁被别的进程占着（编辑器、别的会话的 git status 会短暂拿它）；
        // add 与限定路径的 commit 都可以安全重放，不先查锁文件是否存在（查的时候它可能已经消失）。
        if (result.exitCode !== 128 || Date.now() >= deadline) return result;
        await sleep(100 + Math.floor(Math.random() * 200));
    }
}

/**
 * 提交没有正常完成（add 或 commit 失败，或暂存区里这些路径与 HEAD 相同）时，按结果而不是按 Git 的退出码判定：
 * HEAD 里这些路径的 blob 都等于本次写入的内容时，`<起始HEAD>..HEAD` 有触及它们的提交就是被别的提交带走了，没有就是无需提交；
 * 否则才是真的失败。别的会话不带路径的提交可能发生在我们的 `diff --cached` 之后、`commit` 之前。
 */
export async function resolveCommitOutcome(mainRoot: string, input: {
    startHead: string;
    paths: readonly string[];
    expectedBlobs: ReadonlyMap<string, string>;
    lastFailure: GitResult | null;
    timedOut: boolean;
}): Promise<CommitOutcome> {
    const listing = await gitOutput(mainRoot, ["ls-tree", "-r", "-z", "HEAD", "--", ...input.paths], {readOnly: true});
    const headBlobs = new Map<string, string>();
    for (const entry of splitNul(listing)) {
        const tab = entry.indexOf("\t");
        const oid = entry.slice(0, tab).split(" ")[2];
        if (oid) headBlobs.set(entry.slice(tab + 1), oid);
    }
    const allInHead = input.paths.every((path) => headBlobs.get(path) === input.expectedBlobs.get(path));
    if (allInHead) {
        const touching = splitLines(await gitOutput(mainRoot, ["log", "--format=%H", `${input.startHead}..HEAD`, "--", ...input.paths], {readOnly: true}));
        if (touching.length > 0) return {committed: true, sha: touching[0]!, paths: [...input.paths], viaOtherCommit: true};
        return {committed: false, reason: "nothing_to_commit", paths: [...input.paths]};
    }
    return {
        committed: false,
        reason: input.timedOut ? "git_lock_timeout" : "git_failed",
        writtenPaths: [...input.paths],
        detail: input.lastFailure ? `git 退出码 ${input.lastFailure.exitCode}：${input.lastFailure.stderr.trim()}` : "HEAD 里的内容与写入的不一致",
    };
}

async function commitPaths(mainRoot: string, input: {paths: readonly string[]; message: string; startHead: string; budgetMs: number}): Promise<CommitOutcome> {
    const deadline = Date.now() + input.budgetMs;
    const hashes = splitLines(await gitOutput(mainRoot, ["hash-object", "--", ...input.paths], {readOnly: true}));
    const expectedBlobs = new Map(input.paths.map((path, index) => [path, hashes[index] ?? ""]));
    const resolveWith = (lastFailure: GitResult | null) => resolveCommitOutcome(mainRoot, {
        startHead: input.startHead,
        paths: input.paths,
        expectedBlobs,
        lastFailure,
        timedOut: lastFailure?.exitCode === 128,
    });
    const add = await retryOnGitLock(mainRoot, ["add", "--", ...input.paths], deadline);
    if (add.exitCode !== 0) return resolveWith(add);
    const staged = await runGit(mainRoot, ["diff", "--cached", "--quiet", "--", ...input.paths], {readOnly: true});
    if (staged.exitCode === 0) return resolveWith(null);
    if (staged.exitCode !== 1) return resolveWith(staged);
    const commit = await retryOnGitLock(mainRoot, ["commit", "--quiet", "-m", input.message, "--", ...input.paths], deadline);
    if (commit.exitCode !== 0) return resolveWith(commit);
    const sha = (await gitOutput(mainRoot, ["rev-parse", "HEAD"], {readOnly: true})).trim();
    return {committed: true, sha, paths: [...input.paths], viaOtherCommit: false};
}

function withWrittenPaths(error: unknown, writtenPaths: readonly string[]): unknown {
    if (writtenPaths.length === 0) return error;
    if (isNbdevError(error)) {
        return new NbdevError(error.code, error.message, {cause: error.cause, details: {...error.details, committed: false, writtenPaths: [...writtenPaths]}});
    }
    return new NbdevError("write_failed", `写记录中途失败：${error instanceof Error ? error.message : String(error)}`, {cause: error, details: {committed: false, writtenPaths: [...writtenPaths]}});
}

function localDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** `updated` 字段的取值：本机本地日期。 */
export function recordDate(date: Date): string {
    return localDate(date);
}

/**
 * 写事务：命令行与面板的所有写入都经这里，因此串行。
 * 前置检查 → 取锁 → 锁内复查并记下起始 HEAD → body 计算并登记操作 → 校验全部目标 → 在 run/tmp 里准备 →
 * 写登记表 → 落位 → 路径限定提交（或判定无需提交）→ 放锁。各步失败时留下什么见 docs/cli.md。
 * `repoWrites: false` 的事务（registry import）不要求主工作区在 master，也不碰仓库。
 */
export async function runWriteTransaction<T>(
    context: RepoContext,
    options: TransactionOptions & {repoWrites?: boolean},
    body: (tx: WriteTx) => Promise<{message: string | null; result: T}>,
): Promise<TransactionResult<T>> {
    const {mainRoot} = context;
    const repoWrites = options.repoWrites ?? true;
    const now = (options.now ?? (() => new Date()))();
    if (repoWrites) await assertMainWritable(mainRoot);
    await prepareAgentDirectories(mainRoot);
    const recordsLock = await acquireRecordsLock(mainRoot, options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS);
    const warnings: Warning[] = [];
    const txDir = join(agentPaths(mainRoot).tmpRoot, `${Date.now()}-${process.pid}-${randomBytes(4).toString("hex")}`);
    const written: string[] = [];
    try {
        if (repoWrites) await assertMainWritable(mainRoot);
        const startHead = repoWrites ? (await gitOutput(mainRoot, ["rev-parse", "HEAD"], {readOnly: true})).trim() : "";
        const loaded = await readRegistry(mainRoot);
        const registry = loaded.registry;
        const checkouts = await listCheckouts(mainRoot);
        const operations: Operation[] = [];
        const included: string[] = [];
        const imported: string[] = [];
        let registryChanged = false;
        let scanned: NumberScan | null = null;
        const at = now.toISOString();
        const tx: WriteTx = {
            context,
            now,
            registry,
            checkouts,
            imported,
            async scan() {
                if (scanned) return scanned;
                scanned = await scanNumbers(mainRoot, checkouts, registry);
                const added = importScanned(registry, scannedIds(scanned), at);
                if (added.length > 0) {
                    registryChanged = true;
                    imported.push(...added);
                    warnings.push(loaded.exists
                        ? {code: "unregistered_ids", message: `扫描到 ${added.length} 个登记表里没有的号，已补登为 imported（有人绕过了 nbdev）`, details: {ids: added}}
                        : {code: "registry_initialized", message: `登记表原本不存在，已按扫描结果导入 ${added.length} 个 id`, details: {count: added.length}});
                }
                return scanned;
            },
            claimWork(workId) {
                claimWork(registry, workId, at);
                registryChanged = true;
            },
            claimTask(workId, taskId) {
                claimTask(registry, workId, taskId, at);
                registryChanged = true;
            },
            createDirectory(targetDir, files) {
                const target = normalizeRecordPath(targetDir);
                for (const file of Object.keys(files)) normalizeRecordPath(`${target}/${file}`);
                operations.push({kind: "directory", target, files});
            },
            createFile(target, content) {
                operations.push({kind: "file", target: normalizeRecordPath(target), content});
            },
            replaceFile(target, content, expectedHash) {
                operations.push({kind: "replace", target: normalizeRecordPath(target), content, expectedHash});
            },
            includePaths(paths) {
                included.push(...paths.map(normalizeRecordPath));
            },
            warn(warning) {
                warnings.push(warning);
            },
        };
        const {message, result} = await body(tx);
        const paths = [...new Set([...operations.flatMap(operationPaths), ...included])];
        await validateOperations(mainRoot, operations, included);
        const staged = await stageOperations(txDir, operations);
        if (registryChanged) {
            await recordsLock.assertHealthy("写登记表");
            await writeRegistry(mainRoot, registry);
        }
        if (operations.length > 0) await recordsLock.assertHealthy("落位");
        try {
            for (const [index, operation] of operations.entries()) {
                await applyOperation(mainRoot, operation, staged[index]!);
                written.push(...operationPaths(operation));
            }
        } catch (error) {
            throw withWrittenPaths(error, written);
        }
        if (!repoWrites || message === null || paths.length === 0) {
            return {result, commit: {committed: false, reason: "nothing_to_commit", paths}, warnings};
        }
        try {
            await recordsLock.assertHealthy("提交");
        } catch (error) {
            throw withWrittenPaths(error, paths);
        }
        const commit = await commitPaths(mainRoot, {paths, message, startHead, budgetMs: options.gitLockWaitMs ?? DEFAULT_GIT_LOCK_WAIT_MS});
        if (commit.committed && commit.viaOtherCommit) {
            warnings.push({code: "commit_via_other_commit", message: `本次的文件被别的提交一起带走了：${commit.sha}`, details: {sha: commit.sha, paths}});
        } else if (commit.committed) {
            const committedPaths = splitNul(await gitOutput(mainRoot, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit.sha], {readOnly: true})).sort();
            const expected = [...paths].sort();
            if (committedPaths.join("\n") !== expected.join("\n")) {
                warnings.push({code: "commit_paths_mismatch", message: "本次提交的路径与预期不一致", details: {sha: commit.sha, expected, committed: committedPaths}});
            }
        }
        return {result, commit, warnings};
    } finally {
        await rm(txDir, {recursive: true, force: true}).catch((error: unknown) => {
            warnings.push({code: "tmp_cleanup_failed", message: `删除事务临时目录失败：${error instanceof Error ? error.message : String(error)}`, details: {txDir}});
        });
        const releaseWarning = await recordsLock.release();
        if (releaseWarning) warnings.push(releaseWarning);
    }
}
