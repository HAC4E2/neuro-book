import {lstat, readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {listDocuments} from "./artifacts.js";
import {listDocPaths} from "./docs.js";
import {NbdevError, systemErrorCode} from "./errors.js";
import {parseFrontmatter, setFrontmatterFields} from "./frontmatter.js";
import type {Caller} from "./identity.js";
import {actorOf, readRecordScope, resolveWritableTask, resolveWritableWork, type OperationResult, type RecordScope} from "./operations.js";
import {unsafePathReason} from "./paths.js";
import {WORKS_ROOT, type RepoContext} from "./repo.js";
import {assertPlainText} from "./text-rules.js";
import {assertNoSymlinkOnPath, recordDate, runWriteTransaction, sha256, type TransactionOptions} from "./transaction.js";
import {assertNotStagedRename, readUncommitted, type UncommittedChanges} from "./uncommitted.js";

/**
 * 面板编辑主工作区里已有的文件（命令行以后也可以直接用）：Work 与 Task 的 README、Work 与 Task 目录第一层的文档类产物、
 * 文档树上的主工作区文档。只改已有的文件，不新建、不删除、不改名；能不能改在锁内判定，判据见 `classifyEditable`。
 * worktree 上的文件不给改：写事务的锁与提交只覆盖主工作区，worktree 的暂存区与分支属于别的会话。
 */

export type EditableKind = "work_readme" | "task_readme" | "record_document" | "repo_doc";
export type EditableTarget = {path: string; kind: EditableKind; workId: string | null; taskId: string | null};
export const MAX_EDIT_BYTES = 1024 * 1024;

/** 治理检查禁止的 Task README 旧字段（`scripts/ci/agent-governance-contract.ts` 的 `validateWorkTask`）：编辑不能新增它们。 */
const LEGACY_TASK_FIELDS = ["actionIssueId", "agentWorkflow", "kind", "worktreeId", "branchId", "role"];

const WORK_README = new RegExp(`^${WORKS_ROOT}/([^/]+)/README\\.md$`, "u");
const TASK_README = new RegExp(`^${WORKS_ROOT}/([^/]+)/tasks/([^/]+)/README\\.md$`, "u");
const WORK_DOCUMENT = new RegExp(`^${WORKS_ROOT}/([^/]+)/([^/]+\\.md)$`, "u");
const TASK_DOCUMENT = new RegExp(`^${WORKS_ROOT}/([^/]+)/tasks/([^/]+)/([^/]+\\.md)$`, "u");

function notEditable(path: string, reason: string, message: string): NbdevError {
    return new NbdevError("not_editable", `不能在面板上编辑 ${path}：${message}`, {details: {path, reason}});
}

/** 解析到的 Work、Task 必须逐字等于路径里的（`matchRef` 也认编号前缀）。 */
function sameId(path: string, resolved: string, expected: string): void {
    if (resolved !== expected) throw notEditable(path, "not_record", "路径里的 Work 或 Task 不是一个完整的 id");
}

/**
 * 能不能编辑：先做与面板读文件相同的段检查、路径上没有符号链接、目标是普通文件，再按类：
 * README 逐字是 Work 或 Task 的 README 且记录来源是 master（来自分支的报 `branch_maintained_record`）；
 * 文档类产物在重算的记录索引（`listDocuments`）里逐字出现；主工作区的文档在重算的 `listDocPaths` 里逐字出现。
 * 不用 `classifyDoc` 当判据：它只看后缀与几个目录名，`docs/../x.md`、`docs/.git/x.md` 也会被它分进某一组。
 */
export async function classifyEditable(scope: RecordScope, path: string): Promise<EditableTarget> {
    const {mainRoot} = scope.context;
    const unsafe = unsafePathReason(path);
    if (unsafe !== null) throw notEditable(path, "unsafe_path", `路径不合规（${unsafe}）`);
    if (!path.endsWith(".md")) throw notEditable(path, "not_markdown", "只能编辑 Markdown 文件");
    try {
        await assertNoSymlinkOnPath(mainRoot, path);
    } catch (error) {
        if (error instanceof NbdevError && error.code === "unsafe_path") throw notEditable(path, "symlink", "路径经过符号链接");
        throw error;
    }
    let stats;
    try {
        stats = await lstat(resolve(mainRoot, path));
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") throw notEditable(path, "missing", "文件不存在（只能改已有的文件）");
        throw error;
    }
    if (!stats.isFile()) throw notEditable(path, "not_file", "不是普通文件");
    let match = TASK_README.exec(path);
    if (match) {
        const {workId, taskId} = await resolveWritableTask(scope, match[1]!, match[2]!, {requireCommittedReadme: true});
        sameId(path, `${workId}/${taskId}`, `${match[1]}/${match[2]}`);
        return {path, kind: "task_readme", workId, taskId};
    }
    match = WORK_README.exec(path);
    if (match) {
        const {workId} = await resolveWritableWork(scope, match[1]!, true);
        sameId(path, workId, match[1]!);
        return {path, kind: "work_readme", workId, taskId: null};
    }
    match = TASK_DOCUMENT.exec(path);
    if (match) {
        // Task README 还没提交时不给改它目录里的文档：否则 master 上会出现没有 README 的 Task 目录（与产物、答复的写入同一条不变量）。
        const {workId, taskId} = await resolveWritableTask(scope, match[1]!, match[2]!, {requireCommittedReadme: true});
        sameId(path, `${workId}/${taskId}`, `${match[1]}/${match[2]}`);
        const listed = await listDocuments(mainRoot, `${WORKS_ROOT}/${workId}/tasks/${taskId}`);
        if (!listed.some((document) => document.path === path)) throw notEditable(path, "not_listed", "不在 Task 的文档类产物里");
        return {path, kind: "record_document", workId, taskId};
    }
    match = WORK_DOCUMENT.exec(path);
    if (match) {
        const {workId} = await resolveWritableWork(scope, match[1]!, true);
        sameId(path, workId, match[1]!);
        const listed = await listDocuments(mainRoot, `${WORKS_ROOT}/${workId}`);
        if (!listed.some((document) => document.path === path)) throw notEditable(path, "not_listed", "不在 Work 的文档类产物里");
        return {path, kind: "record_document", workId, taskId: null};
    }
    if (path.startsWith(`${WORKS_ROOT}/`)) throw notEditable(path, "not_listed", "记录目录里只能编辑 README 与第一层的文档类产物");
    if (!(await listDocPaths(mainRoot)).includes(path)) throw notEditable(path, "not_listed", "不在主工作区的文档树上");
    return {path, kind: "repo_doc", workId: null, taskId: null};
}

function decodeUtf8(path: string, bytes: Buffer): string {
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw notEditable(path, "not_utf8", "不是 UTF-8 文本");
    }
}

const fieldValue = (data: Record<string, unknown>, key: string) => JSON.stringify(data[key] ?? null);

/**
 * README 编辑的内容校验：改坏了会直接进 master（`governance:check` 当场失败、`nbdev status` 显示无效记录）；
 * 改 `status` 要走状态切换（释放租约、提醒没答的必答题），不能当一次普通编辑。
 */
function readmeProblems(target: EditableTarget, original: string, next: string): Array<{field: string; reason: string}> {
    const before = parseFrontmatter(original);
    const after = parseFrontmatter(next);
    if (!after.ok) return [{field: "frontmatter", reason: `frontmatter 读不出（${after.reason}）`}];
    const old = before.ok ? before.data : {};
    const problems: Array<{field: string; reason: string}> = [];
    const fixed = target.kind === "work_readme" ? ["schema", "workId", "issueId"] : ["schema", "taskId", "issueId"];
    for (const key of fixed) {
        if (fieldValue(after.data, key) !== fieldValue(old, key)) problems.push({field: key, reason: `不能改 ${key}`});
    }
    if (fieldValue(after.data, "status") !== fieldValue(old, "status")) problems.push({field: "status", reason: "改状态要用状态切换（它会释放租约、提醒没答的必答题）"});
    if (target.kind === "task_readme") {
        for (const key of LEGACY_TASK_FIELDS) {
            if (Object.hasOwn(after.data, key) && !Object.hasOwn(old, key)) problems.push({field: key, reason: `治理检查禁止的旧字段 ${key}`});
        }
    }
    return problems;
}

function editMessage(target: EditableTarget, caller: Caller | null | undefined): string {
    const actor = actorOf(caller);
    const name = target.path.slice(target.path.lastIndexOf("/") + 1);
    if (target.workId === null) return `docs: ${actor}编辑 ${target.path}`;
    const scope = `docs(${target.workId.slice(0, 6)})`;
    const task = target.taskId === null ? "" : `${target.taskId.slice(0, target.taskId.indexOf("-"))} `;
    if (target.kind === "work_readme") return `${scope}: ${actor}编辑 Work README`;
    if (target.kind === "task_readme") return `${scope}: ${actor}编辑 ${task}README`;
    return `${scope}: ${actor}编辑 ${task}${name}`;
}

export type EditableFile = {
    path: string;
    kind: EditableKind | null;
    text: string;
    hash: string;
    editable: boolean;
    /** 不能编辑的原因（错误码，例如 `branch_maintained_record`、`not_editable`）与说明。 */
    reason: {code: string; message: string; details?: Record<string, unknown>} | null;
    uncommitted: UncommittedChanges | null;
    /** 是暂存区里一次改名或复制的一端：编辑会被拒绝（`staged_rename`）。 */
    stagedRename: boolean;
};

/**
 * 打开编辑页：不取锁，现读。不在白名单上的（`not_editable`：路径不合规、经过符号链接、不存在、不在文档树或记录索引上）返回 null，
 * 读接口据此回 404，不会借编辑页读出白名单之外的文件；在白名单上但现在不能写的（例如记录在分支上维护）照常返回、标明原因。
 * 能不能编辑以保存时锁内的判定为准。
 */
export async function readEditableFile(context: RepoContext, path: string): Promise<EditableFile | null> {
    const {mainRoot} = context;
    let kind: EditableKind | null = null;
    let reason: EditableFile["reason"] = null;
    try {
        kind = (await classifyEditable(await readRecordScope(context), path)).kind;
    } catch (error) {
        if (!(error instanceof NbdevError)) throw error;
        if (error.code === "not_editable") return null;
        reason = {code: error.code, message: error.message, details: error.details};
    }
    const bytes = await readFile(resolve(mainRoot, path));
    let text: string;
    try {
        text = decodeUtf8(path, bytes);
    } catch (error) {
        if (!(error instanceof NbdevError)) throw error;
        return null;
    }
    let stagedRename = false;
    try {
        await assertNotStagedRename(mainRoot, path);
    } catch (error) {
        if (!(error instanceof NbdevError) || error.code !== "staged_rename") throw error;
        stagedRename = true;
    }
    return {path, kind, text, hash: sha256(bytes), editable: reason === null && !stagedRename, reason, uncommitted: await readUncommitted(mainRoot, path), stagedRename};
}

export type EditInput = {path: string; content: string; baseHash: string; includeUncommitted?: boolean};
export type EditResult = {path: string; kind: EditableKind; previousHash: string; nextHash: string; changed: boolean; text: string};

/**
 * 编辑一个文件并在 master 上提交这一个路径。锁内依次：判定能不能编辑、比 `baseHash`（不一致 `hash_mismatch`，details 带 `currentHash`）、
 * 拒绝暂存的改名、查未提交改动（有就 `uncommitted_changes`，`includeUncommitted` 才放行）、README 的 frontmatter 校验；
 * README 有改动时把 `updated` 改成当天。内容与原文相同时不写不提交（`changed: false`）。
 */
export async function editRecordFile(context: RepoContext, input: EditInput, options: TransactionOptions & {caller?: Caller | null} = {}): Promise<OperationResult<EditResult>> {
    assertPlainText(input.content, "content", true);
    if (Buffer.byteLength(input.content) > MAX_EDIT_BYTES) throw new NbdevError("usage", `内容超过 ${MAX_EDIT_BYTES} 字节`, {details: {field: "content"}});
    const outcome = await runWriteTransaction(context, options, async (tx) => {
        const {mainRoot} = tx.context;
        const target = await classifyEditable(tx, input.path);
        const bytes = await readFile(resolve(mainRoot, target.path));
        const hash = sha256(bytes);
        const original = decodeUtf8(target.path, bytes);
        if (hash !== input.baseHash) {
            throw new NbdevError("hash_mismatch", `文件在你打开之后被改过：${target.path}`, {details: {path: target.path, expected: input.baseHash, actual: hash, currentHash: hash}});
        }
        await assertNotStagedRename(mainRoot, target.path);
        const uncommitted = await readUncommitted(mainRoot, target.path);
        if (uncommitted && !input.includeUncommitted) {
            throw new NbdevError("uncommitted_changes", `${target.path} 在主工作区有未提交的改动；看过之后确认要一起提交才能保存`, {details: {path: target.path, currentHash: hash, ...uncommitted}});
        }
        const readme = target.kind === "work_readme" || target.kind === "task_readme";
        if (readme) {
            const problems = readmeProblems(target, original, input.content);
            if (problems.length > 0) {
                throw new NbdevError("invalid_record_edit", problems.map((problem) => problem.reason).join("；"), {details: {path: target.path, problems}});
            }
        }
        const next = readme && input.content !== original ? setFrontmatterFields(input.content, {updated: recordDate(tx.now)}) : input.content;
        const result: EditResult = {path: target.path, kind: target.kind, previousHash: hash, nextHash: sha256(next), changed: next !== original, text: next};
        if (!result.changed) return {message: null, result};
        if (target.kind === "repo_doc") tx.replaceRepoFile(target.path, next, hash);
        else tx.replaceFile(target.path, next, hash);
        return {message: editMessage(target, options.caller), result};
    });
    return {data: outcome.result, commit: outcome.commit, warnings: outcome.warnings};
}
