import {lstat, readFile} from "node:fs/promises";
import {posix, resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {
    ackPath,
    answerPath,
    answersAfter,
    artifactContentHash,
    artifactDirPath,
    assertArtifactId,
    closeQuestions,
    listAnswerFileNames,
    listArtifactFiles,
    listArtifactIds,
    nextQuestions,
    nextRecordId,
    PUBLISHABLE_KINDS,
    questionStates,
    QUESTIONS_ARTIFACT,
    readArtifact,
    readArtifactVersion,
    unackedAnswers,
    versionPath,
    adoptionOf,
    type AckRecord,
    type Adoption,
    type AnswerRecord,
    type ArtifactKind,
    type ArtifactRef,
    type ArtifactSnapshot,
    type ArtifactVersion,
    type QuestionRef,
    type QuestionState,
    type SubmittedBy,
    type VersionAction,
    type VersionQuestion,
} from "./artifacts.js";
import {NbdevError, systemErrorCode, type Warning} from "./errors.js";
import {gitOutput, splitNul} from "./git.js";
import {touchCallerLease, type LeaseOptions} from "./lease-ops.js";
import type {LeaseRecord} from "./leases.js";
import {resolveWritableTask} from "./operations.js";
import {readProvenance, writeProvenance, type ProvenanceAction} from "./provenance.js";
import {MARKUP, parseQuestionMarkup, validateAnswerValue, validateQuestionDefinition, type MarkupProblem, type MarkupQuestion, type QuestionOption, type QuestionType} from "./questions.js";
import {listTaskIds, listWorkIds} from "./records.js";
import {WORKS_ROOT, type RepoContext} from "./repo.js";
import {chooseExecutionCheckout, taskSourceInBranchWork} from "./sources.js";
import {matchRef, readTransitionState} from "./status.js";
import {runWriteTransaction, type CommitOutcome, type TransactionOptions, type WriteTx} from "./transaction.js";

/**
 * 产物、提问、答复与确认的写入，以及答复的读取与等待。写入都经写事务：读上一版、列页面文件、解析页面、算哈希、
 * 生成题表与答复 id 全在锁内完成，在锁外算会让后拿到锁的一方写出更旧的内容、或排出倒序的 id。
 * 入库文件里没有会话：写完之后续期调用者的租约，再把“谁写的”记进运行时的 provenance。
 */

export type ArtifactOpOptions = TransactionOptions & Partial<LeaseOptions>;
export type WriteOutcome<T> = {data: T & {lease: LeaseRecord | null}; commit: CommitOutcome; warnings: Warning[]};

const IMAGE_PATTERN = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/iu;
const PAGE_PATTERN = /\.html?$/iu;
const SCRIPT_PATTERN = /\.m?js$/iu;
export const IMAGE_LIMIT_BYTES = 300 * 1024;
export const TASK_IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;

function leaseOptionsOf(options: ArtifactOpOptions): LeaseOptions {
    return {caller: options.caller ?? null, herdr: options.herdr ?? null, now: options.now};
}

function taskLabel(taskId: string): string {
    return taskId.slice(0, taskId.indexOf("-"));
}

function commitMessage(workId: string, taskId: string, text: string): string {
    return `docs(${workId.slice(0, 6)}): ${taskLabel(taskId)} ${text}`;
}

/** 锁内读产物：已有发布记录、但最新一版读不出时拒写，否则新版本会丢掉上一版的题与结局。 */
async function readForWrite(mainRoot: string, ref: ArtifactRef): Promise<ArtifactSnapshot> {
    const snapshot = await readArtifact(mainRoot, ref);
    if (snapshot.versions.length > 0 && !snapshot.latest) {
        throw new NbdevError("invalid_record", `${artifactDirPath(ref)} 最新的发布记录读不出，先修好它`, {details: {path: versionPath(ref, snapshot.versions.at(-1)!), warnings: snapshot.warnings}});
    }
    return snapshot;
}

function answeredIds(snapshot: ArtifactSnapshot): Set<string> {
    if (!snapshot.latest) return new Set();
    return new Set(questionStates(snapshot.latest, snapshot.answers).filter((state) => state.state === "answered").map((state) => state.question.id));
}

function nextVersionNumber(snapshot: ArtifactSnapshot): number {
    return (snapshot.versions.at(-1) ?? 0) + 1;
}

function serialize(value: unknown): string {
    return `${JSON.stringify(value, null, 4)}\n`;
}

type Written = {path: string; content: string; action: ProvenanceAction};

/** 写完之后：续期调用者在这个 Task 上的租约，再记 provenance（失败只给警告，不影响已入库的文件）。 */
async function afterWrite(context: RepoContext, target: {workId: string; taskId: string; action: string}, written: readonly Written[], options: ArtifactOpOptions, warnings: Warning[]): Promise<LeaseRecord | null> {
    const lease = await touchCallerLease(context, target, leaseOptionsOf(options), warnings);
    if (!lease) return null;
    for (const entry of written) {
        try {
            await writeProvenance(context.mainRoot, {path: entry.path, content: entry.content, action: entry.action, lease, now: (options.now ?? (() => new Date()))()});
        } catch (error) {
            if (!(error instanceof NbdevError) || error.code !== "write_failed") throw error;
            warnings.push({code: "provenance_write_failed", message: `记 provenance 失败（只影响“谁问的”这条线索）：${error.message}`, details: error.details});
        }
    }
    return lease;
}

function versionRecord(ref: ArtifactRef & {taskId: string}, fields: {version: number; action: VersionAction; kind: ArtifactKind; title: string; state: "open" | "closed"; entry: string | null; contentHash: string | null; questions: VersionQuestion[]; now: Date}): ArtifactVersion {
    return {
        schema: "nbdev.artifact-version/v1",
        workId: ref.workId,
        taskId: ref.taskId,
        artifactId: ref.artifactId,
        version: fields.version,
        supersedes: fields.version > 1 ? fields.version - 1 : null,
        action: fields.action,
        kind: fields.kind,
        title: fields.title,
        state: fields.state,
        entry: fields.entry,
        contentHash: fields.contentHash,
        questions: fields.questions,
        publishedAt: fields.now.toISOString(),
    };
}

/** 非发布动作（登记、撤回、取代、关闭）生成的新版本：页面不重新解析，沿用上一版的内容字段。 */
function derivedVersion(previous: ArtifactVersion, action: VersionAction, questions: VersionQuestion[], now: Date, state: "open" | "closed" = previous.state): ArtifactVersion {
    return versionRecord({workId: previous.workId, taskId: previous.taskId!, artifactId: previous.artifactId}, {
        version: previous.version + 1, action, kind: previous.kind, title: previous.title, state, entry: previous.entry, contentHash: previous.contentHash, questions, now,
    });
}

// ---------- 发布 ----------

export type PublishInput = {workRef: string; taskRef: string; artifactId: string; kind?: string; title?: string; entry?: string; keep?: readonly string[]; forceVersion?: boolean};
export type PublishData = {
    workId: string;
    taskId: string;
    artifactId: string;
    unchanged: boolean;
    version: number | null;
    path: string | null;
    questions: VersionQuestion[];
    dropped: string[];
    retiredInPage: string[];
    restored: string[];
    committedFiles: string[];
    previous: {version: number; publishedAt: string; publishedBy: string | null} | null;
};

function assertEntry(entry: string): void {
    if (entry === "" || entry.startsWith("/") || entry.includes("\\") || entry.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) {
        throw new NbdevError("usage", `--entry 要写产物目录里的相对路径：${entry}`, {details: {entry}});
    }
}

/** 页面引用的本地文件：先去掉 `#…`、`?…`；指向产物目录之外的、不存在的各给警告。 */
async function checkReferences(mainRoot: string, ref: ArtifactRef, parsed: ReadonlyArray<{page: string; references: ReadonlyArray<{target: string; line: number | null}>}>, warnings: Warning[]): Promise<void> {
    const outside: Array<{page: string; target: string}> = [];
    const missing: Array<{page: string; target: string; line: number | null}> = [];
    const dir = artifactDirPath(ref);
    for (const {page, references} of parsed) {
        for (const {target, line} of references) {
            if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith("//") || target.startsWith("#")) continue;
            const path = target.replace(/[?#].*$/u, "");
            if (path === "") continue;
            const resolved = path.startsWith("/") ? null : posix.normalize(posix.join(posix.dirname(page), decodeURIComponentSafe(path)));
            if (resolved === null || resolved === ".." || resolved.startsWith("../")) {
                outside.push({page, target});
                continue;
            }
            try {
                await lstat(resolve(mainRoot, dir, resolved));
            } catch (error) {
                if (systemErrorCode(error) !== "ENOENT" && systemErrorCode(error) !== "ENOTDIR") throw error;
                missing.push({page, target, line});
            }
        }
    }
    if (outside.length > 0) warnings.push({code: "reference_outside_artifact", message: `有 ${outside.length} 处引用指向产物目录之外：不在 contentHash 的范围内，面板的产物来源也未必提供`, details: {references: outside}});
    if (missing.length > 0) warnings.push({code: "missing_reference", message: `有 ${missing.length} 处引用的本地文件不存在`, details: {references: missing}});
}

function decodeURIComponentSafe(path: string): string {
    try {
        return decodeURIComponent(path);
    } catch (error) {
        // 不是合法的百分号编码：按字面路径判断。
        if (!(error instanceof URIError)) throw error;
        return path;
    }
}

/** 图片体积：单张超过 300 KiB；Task 里 `artifacts/` 与 `evidences/` 的图片（含本次要提交、还没跟踪的）合计超过 5 MiB。只警告。 */
async function checkImages(mainRoot: string, workId: string, taskId: string, ref: ArtifactRef, files: ReadonlyArray<{path: string; size: number}>, warnings: Warning[]): Promise<void> {
    const shots = `.local/agent/works/${workId}/tasks/${taskId}/shots/`;
    const large = files.filter((file) => IMAGE_PATTERN.test(file.path) && file.size > IMAGE_LIMIT_BYTES).map((file) => ({path: `${artifactDirPath(ref)}/${file.path}`, size: file.size}));
    if (large.length > 0) warnings.push({code: "image_too_large", message: `有 ${large.length} 张图片超过 300 KiB：转成 WebP 或缩小，原图留在 ${shots}`, details: {images: large, limit: IMAGE_LIMIT_BYTES}});
    const taskDir = `${WORKS_ROOT}/${workId}/tasks/${taskId}`;
    const listed = splitNul(await gitOutput(mainRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", `${taskDir}/artifacts/`, `${taskDir}/evidences/`], {readOnly: true}));
    let total = 0;
    for (const path of new Set(listed.filter((entry) => IMAGE_PATTERN.test(entry)))) {
        try {
            const stats = await lstat(resolve(mainRoot, path));
            if (stats.isFile()) total += stats.size;
        } catch (error) {
            if (systemErrorCode(error) !== "ENOENT") throw error;
        }
    }
    if (total > TASK_IMAGE_LIMIT_BYTES) warnings.push({code: "task_images_too_large", message: `这个 Task 入库的图片合计 ${total} 字节，超过 5 MiB：转成 WebP 或缩小，原图留在 ${shots}`, details: {totalBytes: total, limit: TASK_IMAGE_LIMIT_BYTES}});
}

/** 产物目录里 Git 有变化的文件（不含删除项）；`versions/` 下没提交的只在 `withVersions` 时算上（`--force-version` 的补救）。 */
async function changedArtifactFiles(mainRoot: string, ref: ArtifactRef, withVersions: boolean): Promise<{changed: string[]; deleted: string[]}> {
    const dir = artifactDirPath(ref);
    const entries = splitNul(await gitOutput(mainRoot, ["status", "--porcelain", "-z", "-uall", "--no-renames", "--", `${dir}/`], {readOnly: true}));
    const changed: string[] = [];
    const deleted: string[] = [];
    for (const entry of entries) {
        const code = entry.slice(0, 2);
        const path = entry.slice(3);
        const inner = path.slice(dir.length + 1);
        if (inner.startsWith("answers/") || (inner.startsWith("versions/") && !withVersions)) continue;
        if (code.includes("D")) deleted.push(path);
        else changed.push(path);
    }
    return {changed, deleted};
}

/** 键排好序的序列化：读回来的记录与新算的记录键顺序可能不同，比较内容时不能受它影响。 */
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function sameContent(left: ArtifactVersion, right: ArtifactVersion): boolean {
    const strip = ({version: _version, supersedes: _supersedes, action: _action, publishedAt: _publishedAt, ...rest}: ArtifactVersion) => rest;
    return canonical(strip(left)) === canonical(strip(right));
}

/**
 * `nbdev artifact publish`：页面文件由会话写在主工作区的产物目录里，这里解析提问、算哈希、生成题表，
 * 写一份发布记录并与有变化的页面文件一起提交。内容与题都没变时不出新版本（`--force-version` 除外）。
 */
export async function publishArtifact(context: RepoContext, input: PublishInput, options: ArtifactOpOptions = {}): Promise<WriteOutcome<PublishData>> {
    assertArtifactId(input.artifactId);
    if (input.artifactId === QUESTIONS_ARTIFACT) throw new NbdevError("invalid_artifact_id", `${QUESTIONS_ARTIFACT} 是 Task 提问集的保留名，用 nbdev ask 登记`, {details: {artifactId: input.artifactId}});
    if (input.entry !== undefined) assertEntry(input.entry);
    let versionContent: string | null = null;
    const {result, commit, warnings} = await runWriteTransaction<PublishData>(context, options, async (tx) => {
        const {mainRoot} = context;
        const {workId, taskId} = await resolveWritableTask(tx, input.workRef, input.taskRef, {requireCommittedReadme: true});
        const ref = {workId, taskId, artifactId: input.artifactId};
        const dir = artifactDirPath(ref);
        const snapshot = await readForWrite(mainRoot, ref);
        const previous = snapshot.latest;
        const entry = input.entry ?? previous?.entry ?? "index.html";
        try {
            if (!(await lstat(resolve(mainRoot, dir, entry))).isFile()) throw new NbdevError("entry_missing", `入口不是文件：${dir}/${entry}`, {details: {path: `${dir}/${entry}`}});
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") throw new NbdevError("entry_missing", `找不到入口：${dir}/${entry}；先把页面写进产物目录`, {details: {path: `${dir}/${entry}`}});
            throw error;
        }
        const files = await listArtifactFiles(mainRoot, ref);
        const contentHash = await artifactContentHash(mainRoot, ref, files);
        const pages: Array<{page: string; references: Array<{target: string; line: number | null}>; title: string | null}> = [];
        const markup: MarkupQuestion[] = [];
        const problems: MarkupProblem[] = [];
        let scriptMarkers = false;
        for (const file of files) {
            if (PAGE_PATTERN.test(file.path)) {
                const parsed = await parseQuestionMarkup(await readFile(resolve(mainRoot, dir, file.path), "utf8"), file.path);
                pages.push({page: file.path, references: parsed.references, title: parsed.title});
                markup.push(...parsed.questions);
                problems.push(...parsed.problems);
                scriptMarkers ||= parsed.scriptMarkers;
            } else if (SCRIPT_PATTERN.test(file.path)) {
                scriptMarkers ||= (await readFile(resolve(mainRoot, dir, file.path), "utf8")).includes(MARKUP.question);
            }
        }
        const seen = new Map<string, string>();
        for (const question of markup) {
            const other = seen.get(question.id);
            if (other !== undefined && !problems.some((problem) => problem.code === "duplicate_question" && problem.questionId === question.id)) {
                problems.push({page: question.page, line: question.line, column: null, questionId: question.id, code: "duplicate_question", message: `题号 ${question.id} 在 ${other} 与 ${question.page} 里都出现了；题号在整个产物内要唯一`});
            }
            seen.set(question.id, question.page);
        }
        if (problems.length > 0) throw new NbdevError("invalid_questions", `页面里的提问标记有 ${problems.length} 处不合规，没有发布`, {details: {problems}});

        const kind = input.kind ?? previous?.kind;
        if (kind === undefined) throw new NbdevError("usage", "第一次发布要给 --kind（design、report、review）", {details: {artifactId: input.artifactId}});
        if (!(PUBLISHABLE_KINDS as readonly string[]).includes(kind)) throw new NbdevError("usage", `--kind 只能是 ${PUBLISHABLE_KINDS.join("、")}：${kind}`, {details: {kind}});
        const title = input.title ?? previous?.title ?? pages.find((page) => page.page === entry)?.title ?? input.artifactId;
        const version = nextVersionNumber(snapshot);
        const next = nextQuestions({previous, markup, version, keep: input.keep ?? [], answeredIds: answeredIds(snapshot)});
        const duplicate = next.problems.find((problem) => problem.code === "duplicate_question");
        if (duplicate) throw new NbdevError("duplicate_question", duplicate.message, {details: {problems: next.problems}});
        if (next.problems.length > 0) throw new NbdevError("usage", next.problems.map((problem) => problem.message).join("；"), {details: {problems: next.problems}});

        const record = versionRecord(ref, {version, action: "publish", kind: kind as ArtifactKind, title, state: "open", entry, contentHash, questions: next.questions, now: tx.now});
        const previousInfo = previous ? {
            version: previous.version,
            publishedAt: previous.publishedAt,
            publishedBy: (await readProvenance(mainRoot, versionPath(ref, previous.version)))?.session.key ?? null,
        } : null;
        const base = {workId, taskId, artifactId: input.artifactId, questions: next.questions, dropped: next.dropped, retiredInPage: next.retiredInPage, restored: next.restored, previous: previousInfo};
        if (previous && !input.forceVersion && previous.state === "open" && sameContent(previous, record)) {
            return {message: null, result: {...base, unchanged: true, version: null, path: null, committedFiles: []}};
        }
        const path = versionPath(ref, version);
        versionContent = serialize(record);
        tx.createFile(path, versionContent);
        const {changed, deleted} = await changedArtifactFiles(mainRoot, ref, input.forceVersion === true);
        tx.includePaths(changed.filter((changedPath) => changedPath !== path));
        if (deleted.length > 0) tx.warn({code: "artifact_deletions_not_committed", message: `产物目录里有 ${deleted.length} 个文件被删掉了，没有随发布提交；需要时手动 git rm 并提交`, details: {paths: deleted}});
        const checks: Warning[] = [];
        await checkImages(mainRoot, workId, taskId, ref, files, checks);
        await checkReferences(mainRoot, ref, pages, checks);
        for (const warning of checks) tx.warn(warning);
        if (next.dropped.length > 0) tx.warn({code: "questions_dropped", message: `页面里没有了、还没答的 ${next.dropped.length} 道题记为被 v${version} 取代；暂时删掉的题用 --keep 保留`, details: {questions: next.dropped}});
        if (next.retiredInPage.length > 0) tx.warn({code: "retired_question_in_page", message: `${next.retiredInPage.length} 道已撤回或已取代的题又出现在页面里，结局不变；题意变了就换题号`, details: {questions: next.retiredInPage}});
        if (previous?.state === "closed") tx.warn({code: "artifact_reopened", message: `产物原已关闭，这次发布重新打开了它；恢复了 ${next.restored.length} 道因关闭而撤回的题`, details: {restored: next.restored}});
        if (scriptMarkers) tx.warn({code: "questions_in_script", message: "脚本、模板或 noscript 里出现了提问标记：渲染出来的题解析不到，写成静态 HTML", details: {}});
        return {
            message: commitMessage(workId, taskId, `发布 ${input.artifactId} v${version}`),
            result: {...base, unchanged: false, version, path, committedFiles: [path, ...changed.filter((changedPath) => changedPath !== path)]},
        };
    });
    const lease = await afterWrite(context, {workId: result.workId, taskId: result.taskId, action: "artifact publish"}, result.path && versionContent ? [{path: result.path, content: versionContent, action: "publish"}] : [], options, warnings);
    return {data: {...result, lease}, commit, warnings};
}

// ---------- 关闭、登记、撤回、取代 ----------

export type DerivedData = {workId: string; taskId: string; artifactId: string; unchanged: boolean; version: number | null; path: string | null; questions: VersionQuestion[]; affected: string[]};

/** 对一个已发布产物生成非发布的新版本（关闭、撤回、取代）；`derive` 在锁内拿到最新的快照。 */
async function deriveVersion(context: RepoContext, target: {workRef: string; taskRef: string; artifactId: string}, action: VersionAction, options: ArtifactOpOptions, derive: (snapshot: ArtifactSnapshot & {latest: ArtifactVersion}, version: number, tx: WriteTx) => Promise<{questions: VersionQuestion[]; state?: "open" | "closed"; affected: string[]; text: string} | null>): Promise<WriteOutcome<DerivedData>> {
    assertArtifactId(target.artifactId);
    let content: string | null = null;
    const {result, commit, warnings} = await runWriteTransaction<DerivedData>(context, options, async (tx) => {
        const {workId, taskId} = await resolveWritableTask(tx, target.workRef, target.taskRef, {requireCommittedReadme: true});
        const ref = {workId, taskId, artifactId: target.artifactId};
        const snapshot = await readForWrite(context.mainRoot, ref);
        if (!snapshot.latest) throw new NbdevError("artifact_not_found", `产物还没有发布记录：${artifactDirPath(ref)}`, {details: {...ref}});
        const latest = snapshot.latest;
        const version = latest.version + 1;
        const derived = await derive({...snapshot, latest}, version, tx);
        if (!derived) return {message: null, result: {workId, taskId, artifactId: ref.artifactId, unchanged: true, version: null, path: null, questions: latest.questions, affected: []}};
        const record = derivedVersion(latest, action, derived.questions, tx.now, derived.state);
        const path = versionPath(ref, version);
        content = serialize(record);
        tx.createFile(path, content);
        return {message: commitMessage(workId, taskId, derived.text), result: {workId, taskId, artifactId: ref.artifactId, unchanged: false, version, path, questions: record.questions, affected: derived.affected}};
    });
    const lease = await afterWrite(context, {workId: result.workId, taskId: result.taskId, action: `artifact ${action}`}, result.path && content ? [{path: result.path, content, action}] : [], options, warnings);
    return {data: {...result, lease}, commit, warnings};
}

/** `nbdev artifact close`：未答的题记成因关闭而撤回；已关闭时不出新版本。 */
export function closeArtifact(context: RepoContext, input: {workRef: string; taskRef: string; artifactId: string}, options: ArtifactOpOptions = {}): Promise<WriteOutcome<DerivedData>> {
    return deriveVersion(context, input, "close", options, async (snapshot, version, tx) => {
        if (snapshot.latest.state === "closed") {
            tx.warn({code: "already_closed", message: `${snapshot.ref.artifactId} 已经关闭，没有出新版本`, details: {version: snapshot.latest.version}});
            return null;
        }
        const closed = closeQuestions(snapshot.latest, answeredIds(snapshot), version);
        return {questions: closed.questions, state: "closed", affected: closed.withdrawn, text: `关闭 ${snapshot.ref.artifactId}（v${version}）`};
    });
}

export type QuestionSpec = {id: string; type: string; label: string; options?: readonly QuestionOption[]; required?: boolean; recommend?: readonly string[]; about?: string | null};

function assertAbout(about: string): void {
    if (about === "" || about.startsWith("/") || about.includes("\\") || about.split("/").some((segment) => segment === ".." || segment === "")) {
        throw new NbdevError("usage", `--about 要写仓库根相对的路径（不以 / 开头、不含 ..）：${about}`, {details: {about}});
    }
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") return false;
        throw error;
    }
}

/**
 * `nbdev ask`：登记一道或几道题。不给 `artifactId` 时记进这个 Task 的提问集（第一次登记时建它）；
 * 给了就追加到那个产物的下一版。`about` 只校验格式，主工作区与调用者的 checkout 里都找不到时给警告（Spec 草稿常在实现分支上）。
 */
export async function askQuestions(context: RepoContext, input: {workRef: string; taskRef: string; artifactId?: string; questions: readonly QuestionSpec[]}, options: ArtifactOpOptions = {}): Promise<WriteOutcome<DerivedData>> {
    const artifactId = input.artifactId ?? QUESTIONS_ARTIFACT;
    assertArtifactId(artifactId);
    if (input.questions.length === 0) throw new NbdevError("usage", "没有要登记的题");
    const problems: Array<{questionId: string; code: string; message: string}> = [];
    for (const spec of input.questions) {
        for (const problem of validateQuestionDefinition({id: spec.id, type: spec.type, label: spec.label, options: spec.options ?? [], recommend: spec.recommend ?? []})) {
            problems.push({questionId: spec.id, ...problem});
        }
        if (spec.about) assertAbout(spec.about);
    }
    if (problems.length > 0) throw new NbdevError("invalid_questions", `有 ${problems.length} 处题的写法不合规，没有登记`, {details: {problems}});
    let content: string | null = null;
    const {result, commit, warnings} = await runWriteTransaction<DerivedData>(context, options, async (tx) => {
        const {workId, taskId} = await resolveWritableTask(tx, input.workRef, input.taskRef, {requireCommittedReadme: true});
        const ref = {workId, taskId, artifactId};
        const snapshot = await readForWrite(context.mainRoot, ref);
        const previous = snapshot.latest;
        if (!previous && artifactId !== QUESTIONS_ARTIFACT) throw new NbdevError("artifact_not_found", `产物还没有发布记录：${artifactDirPath(ref)}；先 nbdev artifact publish`, {details: {...ref}});
        if (previous?.state === "closed") throw new NbdevError("artifact_closed", `${artifactId} 已经关闭，不能再登记提问；重新发布会打开它`, {details: {...ref}});
        const existing = new Set(previous?.questions.map((question) => question.id) ?? []);
        const fresh = new Set<string>();
        for (const spec of input.questions) {
            if (existing.has(spec.id) || fresh.has(spec.id)) throw new NbdevError("duplicate_question", `题号 ${spec.id} 已经用过（题号不复用，题意变了就换题号）`, {details: {...ref, questionId: spec.id}});
            fresh.add(spec.id);
        }
        const version = nextVersionNumber(snapshot);
        for (const spec of input.questions) {
            if (spec.about && !await pathExists(resolve(context.mainRoot, spec.about)) && !await pathExists(resolve(context.callerRoot, spec.about))) {
                tx.warn({code: "about_not_found", message: `--about 指向的文件在主工作区与当前 checkout 里都找不到：${spec.about}`, details: {about: spec.about, questionId: spec.id}});
            }
        }
        const added: VersionQuestion[] = input.questions.map((spec) => ({
            id: spec.id,
            type: spec.type as QuestionType,
            label: spec.label,
            options: [...(spec.options ?? [])],
            required: spec.required ?? true,
            recommend: [...(spec.recommend ?? [])],
            origin: "ask",
            page: null,
            about: spec.about ?? null,
            since: version,
            outcome: null,
        }));
        const record = previous
            ? derivedVersion(previous, "ask", [...previous.questions, ...added], tx.now)
            : versionRecord(ref, {version, action: "ask", kind: "questions", title: `${taskId} 的提问`, state: "open", entry: null, contentHash: null, questions: added, now: tx.now});
        const path = versionPath(ref, version);
        content = serialize(record);
        tx.createFile(path, content);
        const ids = added.map((question) => question.id).join("、");
        return {message: commitMessage(workId, taskId, `登记提问 ${artifactId === QUESTIONS_ARTIFACT ? ids : `${artifactId}#${ids}`}`), result: {workId, taskId, artifactId, unchanged: false, version, path, questions: record.questions, affected: added.map((question) => question.id)}};
    });
    const lease = await afterWrite(context, {workId: result.workId, taskId: result.taskId, action: "ask"}, result.path && content ? [{path: result.path, content, action: "ask"}] : [], options, warnings);
    return {data: {...result, lease}, commit, warnings};
}

/** `<artifactId>#<题号>`，或只写题号（Task 的提问集）。 */
export function parseQuestionTarget(text: string): {artifactId: string; questionId: string} {
    const hash = text.indexOf("#");
    return hash < 0 ? {artifactId: QUESTIONS_ARTIFACT, questionId: text} : {artifactId: text.slice(0, hash), questionId: text.slice(hash + 1)};
}

function liveQuestion(snapshot: ArtifactSnapshot & {latest: ArtifactVersion}, questionId: string): VersionQuestion {
    const question = snapshot.latest.questions.find((entry) => entry.id === questionId);
    if (!question) throw new NbdevError("question_not_found", `${snapshot.ref.artifactId} 里没有题 ${questionId}`, {details: {...snapshot.ref, questionId}});
    if (question.outcome) throw new NbdevError("question_closed", `题 ${questionId} 已经${question.outcome.kind === "withdrawn" ? "撤回" : "被取代"}`, {details: {...snapshot.ref, questionId, outcome: question.outcome}});
    return question;
}

/** `nbdev ask withdraw`：撤回一道活的题。 */
export function withdrawQuestion(context: RepoContext, input: {workRef: string; taskRef: string; question: string}, options: ArtifactOpOptions = {}): Promise<WriteOutcome<DerivedData>> {
    const {artifactId, questionId} = parseQuestionTarget(input.question);
    return deriveVersion(context, {workRef: input.workRef, taskRef: input.taskRef, artifactId}, "withdraw", options, async (snapshot, version) => {
        liveQuestion(snapshot, questionId);
        const questions = snapshot.latest.questions.map((question): VersionQuestion => (question.id === questionId ? {...question, outcome: {kind: "withdrawn", in: version, reason: "explicit"}} : question));
        return {questions, affected: [questionId], text: `撤回提问 ${artifactId}#${questionId}`};
    });
}

/** 解析取代者：`<workRef>/<taskRef>/<artifactId>#<题号>`，或同一个 Task 里的 `<artifactId>#<题号>`、题号。按 master 上的记录找，取代者必须是活的题。 */
async function resolveSupersededBy(mainRoot: string, current: {workId: string; taskId: string}, text: string): Promise<QuestionRef> {
    const slash = text.split("/");
    let workId = current.workId;
    let taskId = current.taskId;
    let rest = text;
    if (slash.length === 3) {
        const works = matchRef(await listWorkIds(mainRoot), slash[0]!, "work");
        if (works.length !== 1) throw new NbdevError("work_not_found", `--by 里的 Work 找不到或有歧义：${slash[0]}`, {details: {by: text}});
        workId = works[0]!;
        const tasks = matchRef(await listTaskIds(mainRoot, workId), slash[1]!, "task");
        if (tasks.length !== 1) throw new NbdevError("task_not_found", `--by 里的 Task 找不到或有歧义：${slash[1]}`, {details: {by: text}});
        taskId = tasks[0]!;
        rest = slash[2]!;
    } else if (slash.length !== 1) {
        throw new NbdevError("usage", `--by 写 <workRef>/<taskRef>/<artifactId>#<题号>、<artifactId>#<题号> 或题号：${text}`, {details: {by: text}});
    }
    const {artifactId, questionId} = parseQuestionTarget(rest);
    const snapshot = await readArtifact(mainRoot, {workId, taskId, artifactId});
    if (!snapshot.latest) throw new NbdevError("artifact_not_found", `--by 指向的产物没有发布记录：${workId}/${taskId}/${artifactId}`, {details: {by: text}});
    liveQuestion({...snapshot, latest: snapshot.latest}, questionId);
    return {workId, taskId, artifactId, questionId};
}

/** `nbdev ask supersede … --by …`：记下取代者（规范化的完整 id）。 */
export function supersedeQuestion(context: RepoContext, input: {workRef: string; taskRef: string; question: string; by: string}, options: ArtifactOpOptions = {}): Promise<WriteOutcome<DerivedData>> {
    const {artifactId, questionId} = parseQuestionTarget(input.question);
    return deriveVersion(context, {workRef: input.workRef, taskRef: input.taskRef, artifactId}, "supersede", options, async (snapshot, version) => {
        liveQuestion(snapshot, questionId);
        const by = await resolveSupersededBy(context.mainRoot, {workId: snapshot.ref.workId, taskId: snapshot.ref.taskId!}, input.by);
        if (by.workId === snapshot.ref.workId && by.taskId === snapshot.ref.taskId && by.artifactId === artifactId && by.questionId === questionId) {
            throw new NbdevError("usage", "题不能被自己取代", {details: {question: input.question}});
        }
        const questions = snapshot.latest.questions.map((question): VersionQuestion => (question.id === questionId ? {...question, outcome: {kind: "superseded", in: version, by}} : question));
        return {questions, affected: [questionId], text: `取代提问 ${artifactId}#${questionId}`};
    });
}

// ---------- 答复与确认 ----------

export type AnswerInput = {
    workRef: string;
    taskRef: string;
    artifactId: string;
    values: Readonly<Record<string, unknown>>;
    /** 命令行写法的取值（`answers record --set 题号=值`）：按题的类型换算，`multi` 用逗号分隔，`confirm` 写 yes 或 no。 */
    rawValues?: Readonly<Record<string, string>>;
    comments?: Readonly<Record<string, string>>;
    note?: string | null;
    /** 答复针对的版本（面板填开发者打开的那一版）；缺省为最新一版。 */
    artifactVersion?: number;
    submittedBy: SubmittedBy;
    /** 开发者按下提交的时刻；缺省为写入时。 */
    submittedAt?: string;
};
export type AnswerData = {workId: string; taskId: string; artifactId: string; answer: AnswerRecord; path: string};

/**
 * 写一份答复（`answers record` 与 t10 的面板共用）。取值按答复针对的那一版校验，只能答还活着的题。
 * 答复 id 在锁内用重读的时钟单调生成：锁之前读的时钟可能早于先拿到锁的别人，游标会漏掉它。
 */
export async function submitAnswer(context: RepoContext, input: AnswerInput, options: ArtifactOpOptions = {}): Promise<WriteOutcome<AnswerData>> {
    assertArtifactId(input.artifactId);
    if (Object.keys(input.values).length === 0 && Object.keys(input.rawValues ?? {}).length === 0) throw new NbdevError("invalid_answer", "答复里没有任何题的取值");
    let content: string | null = null;
    const {result, commit, warnings} = await runWriteTransaction<AnswerData>(context, options, async (tx) => {
        const {workId, taskId} = await resolveWritableTask(tx, input.workRef, input.taskRef, {requireCommittedReadme: true});
        const ref = {workId, taskId, artifactId: input.artifactId};
        const snapshot = await readForWrite(context.mainRoot, ref);
        if (!snapshot.latest) throw new NbdevError("artifact_not_found", `产物还没有发布记录：${artifactDirPath(ref)}`, {details: {...ref}});
        const latest = snapshot.latest;
        const targetVersion = input.artifactVersion ?? latest.version;
        const target = targetVersion === latest.version ? latest : await readArtifactVersion(context.mainRoot, ref, targetVersion, []);
        if (!target) throw new NbdevError("artifact_not_found", `${input.artifactId} 没有 v${targetVersion}`, {details: {...ref, version: targetVersion}});
        const values: Record<string, unknown> = {...input.values};
        for (const [questionId, text] of Object.entries(input.rawValues ?? {})) {
            const definition = target.questions.find((question) => question.id === questionId);
            if (!definition) throw new NbdevError("question_not_found", `v${targetVersion} 里没有题 ${questionId}`, {details: {...ref, questionId}});
            values[questionId] = parseRawValue(definition.type, questionId, text);
        }
        const problems: Array<{questionId: string; reason: string}> = [];
        for (const [questionId, value] of Object.entries(values)) {
            const definition = target.questions.find((question) => question.id === questionId);
            if (!definition) throw new NbdevError("question_not_found", `v${targetVersion} 里没有题 ${questionId}`, {details: {...ref, questionId}});
            liveQuestion({...snapshot, latest}, questionId);
            const reason = validateAnswerValue(definition, value);
            if (reason) problems.push({questionId, reason});
        }
        for (const questionId of Object.keys(input.comments ?? {})) {
            if (!target.questions.some((question) => question.id === questionId)) throw new NbdevError("question_not_found", `说明写给了不存在的题 ${questionId}`, {details: {...ref, questionId}});
        }
        if (problems.length > 0) throw new NbdevError("invalid_answer", problems.map((problem) => `${problem.questionId}：${problem.reason}`).join("；"), {details: {problems}});
        const now = new Date();
        const answerId = nextRecordId((await listAnswerFileNames(context.mainRoot, ref)).map((name) => name.slice(0, -".json".length)), now);
        const answer: AnswerRecord = {
            schema: "nbdev.answer/v1",
            workId,
            taskId,
            artifactId: input.artifactId,
            answerId,
            artifactVersion: target.version,
            contentHash: target.contentHash,
            submittedAt: input.submittedAt ?? now.toISOString(),
            submittedBy: input.submittedBy,
            values,
            comments: {...(input.comments ?? {})},
            note: input.note ?? null,
        };
        const path = answerPath(ref, answerId);
        content = serialize(answer);
        tx.createFile(path, content);
        const verb = input.submittedBy.kind === "agent-transcribed" ? "代录" : "记下";
        return {message: commitMessage(workId, taskId, `${verb} ${input.artifactId} 的答复`), result: {workId, taskId, artifactId: input.artifactId, answer, path}};
    });
    const lease = await afterWrite(context, {workId: result.workId, taskId: result.taskId, action: "answers record"}, content ? [{path: result.path, content, action: "record"}] : [], options, warnings);
    return {data: {...result, lease}, commit, warnings};
}

/** 命令行写法的取值换算成答复里的值。 */
function parseRawValue(type: QuestionType, questionId: string, text: string): unknown {
    if (type === "multi") return text.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
    if (type === "confirm") {
        if (["yes", "true"].includes(text.trim().toLowerCase())) return true;
        if (["no", "false"].includes(text.trim().toLowerCase())) return false;
        throw new NbdevError("invalid_answer", `确认题 ${questionId} 只能写 yes 或 no：${text}`, {details: {questionId, value: text}});
    }
    return text;
}

export type AckData = {workId: string; taskId: string; artifactId: string; acked: boolean; ack: AckRecord | null; path: string | null};

/**
 * `nbdev answers ack`：确认当时还未确认的全部答复，并把 `--include` 列出的记录（相对主工作区根，只收 `.agents/works/` 下）放进同一个提交。
 * 在锁内算覆盖哪些答复，所以并发写入的答复要么被确认、要么留到下一次，不会被跳过。
 */
export async function ackAnswers(context: RepoContext, input: {workRef: string; taskRef: string; artifactId: string; include?: readonly string[]}, options: ArtifactOpOptions = {}): Promise<WriteOutcome<AckData>> {
    assertArtifactId(input.artifactId);
    let content: string | null = null;
    const {result, commit, warnings} = await runWriteTransaction<AckData>(context, options, async (tx) => {
        const {workId, taskId} = await resolveWritableTask(tx, input.workRef, input.taskRef, {requireCommittedReadme: true});
        // 先登记一起提交的路径：路径不合规（不在 .agents/works/ 下）时，没有新答复也要报错。
        tx.includePaths(input.include ?? []);
        const ref = {workId, taskId, artifactId: input.artifactId};
        const snapshot = await readForWrite(context.mainRoot, ref);
        if (!snapshot.latest) throw new NbdevError("artifact_not_found", `产物还没有发布记录：${artifactDirPath(ref)}`, {details: {...ref}});
        if (snapshot.answers.length === 0) throw new NbdevError("no_answers", `${input.artifactId} 还没有任何答复`, {details: {...ref}});
        const pending = unackedAnswers(snapshot.answers, snapshot.acks).map((answer) => answer.answerId).sort();
        if (pending.length === 0) {
            tx.warn({code: "already_acked", message: `${input.artifactId} 的答复都已确认，没有写确认${input.include?.length ? "；--include 的文件也没有提交" : ""}`, details: {include: input.include ?? []}});
            return {message: null, result: {workId, taskId, artifactId: input.artifactId, acked: false, ack: null, path: null}};
        }
        const now = new Date();
        const ackId = nextRecordId((await listAnswerFileNames(context.mainRoot, ref)).map((name) => name.slice(0, -".json".length)), now);
        const ack: AckRecord = {schema: "nbdev.answer-ack/v1", workId, taskId, artifactId: input.artifactId, ackId, answers: pending, through: pending.at(-1)!, included: [...(input.include ?? [])], ackedAt: now.toISOString()};
        const path = ackPath(ref, ackId);
        content = serialize(ack);
        tx.createFile(path, content);
        return {message: commitMessage(workId, taskId, `确认采纳 ${input.artifactId} 的答复`), result: {workId, taskId, artifactId: input.artifactId, acked: true, ack, path}};
    });
    const lease = await afterWrite(context, {workId: result.workId, taskId: result.taskId, action: "answers ack"}, result.path && content ? [{path: result.path, content, action: "ack"}] : [], options, warnings);
    return {data: {...result, lease}, commit, warnings};
}

// ---------- 读答复与等待 ----------

export type AnswersFilter = "all" | "pending" | "unacked";
export type AnswersQuery = {workRef?: string; taskRef?: string; artifactId?: string; filter: AnswersFilter; since?: string};
export type ArtifactAnswersView = {
    workId: string;
    taskId: string;
    artifactId: string;
    kind: ArtifactKind;
    title: string;
    version: number;
    state: "open" | "closed";
    publishedAt: string;
    openRequired: number;
    adoption: Adoption;
    questions: QuestionState[];
    answers: AnswerRecord[];
    acks: AckRecord[];
    unacked: string[];
    cursor: string | null;
};
export type AnswersResult = {artifacts: ArtifactAnswersView[]; cursor: string | null; scope: ArtifactRef[]; warnings: Warning[]};

function answersView(snapshot: ArtifactSnapshot & {latest: ArtifactVersion}): ArtifactAnswersView {
    const states = questionStates(snapshot.latest, snapshot.answers);
    const {latest} = snapshot;
    return {
        workId: latest.workId,
        taskId: latest.taskId!,
        artifactId: latest.artifactId,
        kind: latest.kind,
        title: latest.title,
        version: latest.version,
        state: latest.state,
        publishedAt: latest.publishedAt,
        openRequired: states.filter((state) => state.state === "open" && state.question.required).length,
        adoption: adoptionOf(snapshot.answers, snapshot.acks),
        questions: states,
        answers: snapshot.answers,
        acks: snapshot.acks,
        unacked: unackedAnswers(snapshot.answers, snapshot.acks).map((answer) => answer.answerId),
        cursor: snapshot.answers.at(-1)?.answerId ?? null,
    };
}

/** 按查询挑出产物与题：`pending` 只留有 open 必答题的产物与这些题；`since` 只留有更新答复的；`unacked` 只留有未确认答复的。 */
function select(views: readonly ArtifactAnswersView[], query: AnswersQuery): ArtifactAnswersView[] {
    if (query.since !== undefined) {
        return views.flatMap((view) => {
            const newer = answersAfter(view.answers, query.since!);
            return newer.length > 0 ? [{...view, answers: newer}] : [];
        });
    }
    if (query.filter === "pending") {
        return views.filter((view) => view.openRequired > 0).map((view) => ({...view, questions: view.questions.filter((state) => state.state === "open" && state.question.required)}));
    }
    if (query.filter === "unacked") return views.filter((view) => view.unacked.length > 0);
    return [...views];
}

/** 解析查询的范围：Work、Task 按 master 与过渡期的执行 worktree 找，产物从 Task 记录所在的 checkout 读。 */
async function answersScope(context: RepoContext, query: AnswersQuery): Promise<Array<{root: string; ref: ArtifactRef & {taskId: string}}>> {
    const {mainRoot} = context;
    const transition = await readTransitionState(mainRoot);
    let workIds = [...new Set([...await listWorkIds(mainRoot), ...transition.branchChanges.keys()])].sort();
    if (query.workRef !== undefined) {
        const matched = matchRef(workIds, query.workRef, "work");
        if (matched.length === 0) throw new NbdevError("work_not_found", `找不到 Work：${query.workRef}`, {details: {workRef: query.workRef}});
        if (matched.length > 1) throw new NbdevError("ambiguous_work", `Work 编号对应多个目录：${matched.join("、")}`, {details: {workRef: query.workRef, candidates: matched}});
        workIds = matched;
    }
    const scope: Array<{root: string; ref: ArtifactRef & {taskId: string}}> = [];
    for (const workId of workIds) {
        const copies = transition.branchChanges.get(workId);
        const execution = copies ? await chooseExecutionCheckout(mainRoot, workId, copies, transition.registry) : null;
        const executionTasks = execution ? await listTaskIds(execution.chosen.root, workId) : [];
        let taskIds = [...new Set([...executionTasks, ...await listTaskIds(mainRoot, workId)])].sort();
        if (query.taskRef !== undefined) {
            const matched = matchRef(taskIds, query.taskRef, "task");
            if (matched.length === 0) throw new NbdevError("task_not_found", `找不到 Task：${workId}/${query.taskRef}`, {details: {workId, taskRef: query.taskRef}});
            if (matched.length > 1) throw new NbdevError("ambiguous_task", `Task 编号对应多个目录：${matched.join("、")}`, {details: {workId, candidates: matched}});
            taskIds = matched;
        }
        for (const taskId of taskIds) {
            const source = execution ? taskSourceInBranchWork(transition.registry, workId, taskId, executionTasks.includes(taskId)) : "master";
            const root = source === "branch" ? execution!.chosen.root : mainRoot;
            const artifactIds = await listArtifactIds(root, workId, taskId);
            if (query.artifactId !== undefined) {
                if (!artifactIds.includes(query.artifactId)) throw new NbdevError("artifact_not_found", `找不到产物：${workId}/${taskId}/${query.artifactId}`, {details: {workId, taskId, artifactId: query.artifactId}});
                scope.push({root, ref: {workId, taskId, artifactId: query.artifactId}});
            } else {
                for (const artifactId of artifactIds) scope.push({root, ref: {workId, taskId, artifactId}});
            }
        }
    }
    return scope;
}

/** 按引用找到 Work 与 Task（`master` 或过渡期的执行 worktree），用于命令行给读命令续期租约。 */
export async function resolveTaskRef(context: RepoContext, workRef: string, taskRef: string): Promise<{workId: string; taskId: string}> {
    const [entry] = await answersScope(context, {workRef, taskRef, filter: "all"});
    if (entry) return {workId: entry.ref.workId, taskId: entry.ref.taskId};
    const transition = await readTransitionState(context.mainRoot);
    const workId = matchRef([...new Set([...await listWorkIds(context.mainRoot), ...transition.branchChanges.keys()])], workRef, "work")[0]!;
    const copies = transition.branchChanges.get(workId);
    const execution = copies ? await chooseExecutionCheckout(context.mainRoot, workId, copies, transition.registry) : null;
    const taskIds = [...new Set([...await listTaskIds(context.mainRoot, workId), ...(execution ? await listTaskIds(execution.chosen.root, workId) : [])])];
    return {workId, taskId: matchRef(taskIds, taskRef, "task")[0]!};
}

/** `nbdev answers`：读答复、题的状态与确认。只读（续期租约由命令行边界做）。 */
export async function readAnswers(context: RepoContext, query: AnswersQuery): Promise<AnswersResult> {
    const scope = await answersScope(context, query);
    const warnings: Warning[] = [];
    const views: ArtifactAnswersView[] = [];
    for (const {root, ref} of scope) {
        const snapshot = await readArtifact(root, ref);
        warnings.push(...snapshot.warnings);
        if (snapshot.latest) views.push(answersView({...snapshot, latest: snapshot.latest}));
    }
    const artifacts = select(views, query);
    const cursor = views.flatMap((view) => (view.cursor ? [view.cursor] : [])).sort().at(-1) ?? null;
    return {artifacts, cursor, scope: scope.map((entry) => entry.ref), warnings};
}

export type WaitOptions = {timeoutMs: number; pollMs?: number; signal?: AbortSignal; onWaiting?: (scope: readonly ArtifactRef[]) => void};

/**
 * `nbdev answers --wait`：选中的答复不为空就返回。范围在开始时完整读一次定下；之后每秒只 readdir 主工作区里这些产物的 `answers/`
 * （答复只写在 master 上），不跑 Git、不做过渡期判定，目录有变化才重读那个产物。超时报 `wait_timeout`，被信号打断报 `wait_interrupted`。
 */
export async function waitForAnswers(context: RepoContext, query: AnswersQuery, options: WaitOptions): Promise<AnswersResult> {
    const effective: AnswersQuery = query.since === undefined && query.filter === "all" ? {...query, filter: "unacked"} : query;
    const first = await readAnswers(context, effective);
    if (first.artifacts.length > 0) return first;
    const deadline = Date.now() + options.timeoutMs;
    const pollMs = options.pollMs ?? 1_000;
    const known = new Map<string, string>();
    const keyOf = (ref: ArtifactRef) => `${ref.workId}/${ref.taskId}/${ref.artifactId}`;
    for (const ref of first.scope) known.set(keyOf(ref), (await listAnswerFileNames(context.mainRoot, ref)).join("\n"));
    const views = new Map<string, ArtifactAnswersView>();
    options.onWaiting?.(first.scope);
    for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new NbdevError("wait_timeout", `等了 ${Math.round(options.timeoutMs / 1000)} 秒还没有答复；按原参数再挂一次`, {details: {cursor: first.cursor}});
        try {
            await sleep(Math.min(pollMs, remaining), undefined, {signal: options.signal});
        } catch (error) {
            if (options.signal?.aborted) throw new NbdevError("wait_interrupted", "等待被打断了；按原参数再挂一次", {cause: error, details: {cursor: first.cursor}});
            throw error;
        }
        for (const ref of first.scope) {
            const names = (await listAnswerFileNames(context.mainRoot, ref)).join("\n");
            if (names === known.get(keyOf(ref))) continue;
            known.set(keyOf(ref), names);
            const snapshot = await readArtifact(context.mainRoot, ref);
            if (snapshot.latest) views.set(keyOf(ref), answersView({...snapshot, latest: snapshot.latest}));
        }
        const selected = select([...views.values()], effective);
        if (selected.length > 0) {
            const cursor = [first.cursor, ...[...views.values()].map((view) => view.cursor)].filter((value): value is string => value !== null).sort().at(-1) ?? null;
            return {artifacts: selected, cursor, scope: first.scope, warnings: first.warnings};
        }
    }
}
