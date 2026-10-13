import {randomBytes} from "node:crypto";
import {chmod, mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {ackPath, listArtifactIds, readArtifact, RECORD_ID_PATTERN, versionPath, type AckRecord, type AnswerRecord, type ArtifactRef} from "./artifacts.js";
import {NbdevError, systemErrorCode, type Warning} from "./errors.js";
import {parseTaskId, parseWorkId, taskNumberLabel, workNumberLabel} from "./ids.js";
import {verifiedProvenance} from "./provenance.js";
import {AGENT_LOCAL_ROOT} from "./registry.js";

/**
 * 答复之后通知提问的会话（t11）。待发的通知不落盘，每次现算；`.local/agent/run/notify/` 只记“对哪几份答复、向哪个会话做过什么”，
 * 用来去重与显示历史。现算的输入：入库的答复与确认、题与确认的 provenance（谁问的、谁确认的）、尝试记录、启用时刻。
 * herdr 里能不能找到这个会话、能不能投，由面板服务在投递时判定（`src/server/notifier.ts`）。
 */

export const NOTIFY_ROOT = `${AGENT_LOCAL_ROOT}/run/notify`;
export const NOTIFY_SCHEMA = "nbdev.notify/v1";

/**
 * 尝试与选择的结果：
 * - `pending`：意图（调 herdr 之前写的）；只有意图、没有结果的按 `uncertain` 算（面板在投递途中退出）。
 * - `delivered`、`delivered_into_blocked`、`delivered_maybe_wrong_session`：写进去了（后两种要开发者马上看终端）。
 * - `uncertain`：herdr 回 `agent_prompt_stalled`、自己等到点（`timeout`）或本地超时（`client_timeout`）：不代表没送达，不重发。
 * - `skipped`：开发者选了“不通知”。
 * - 其余（`agent_blocked`、`not_deliverable`、`session_changed`、`failed`）：没写进去，下次照常排队。
 */
export type NotifyResult = "pending" | "delivered" | "delivered_into_blocked" | "delivered_maybe_wrong_session" | "uncertain" | "skipped" | "agent_blocked" | "not_deliverable" | "session_changed" | "failed";
const DONE_RESULTS: ReadonlySet<NotifyResult> = new Set(["delivered", "delivered_into_blocked", "delivered_maybe_wrong_session", "uncertain", "skipped"]);

export type NotifyRecord = {
    schema: typeof NOTIFY_SCHEMA;
    attemptId: string;
    at: string;
    workId: string;
    taskId: string;
    /** 通知的对象：提问者的会话键；手动另选时是被选的会话，`askerKey` 仍是提问者。 */
    sessionKey: string;
    askerKey: string;
    paneId: string | null;
    answers: string[];
    result: NotifyResult;
    code: string | null;
    message: string | null;
    manual: boolean;
};

/** 一个产物里与通知有关的数据。`askers`：题号到提问者会话键（provenance 读不到为 null）；`ackers`：确认 id 到确认者会话键。 */
export type ArtifactNotifyInput = {artifactId: string; answers: AnswerRecord[]; acks: AckRecord[]; askers: ReadonlyMap<string, string | null>; askerPanes: ReadonlyMap<string, string | null>; ackers: ReadonlyMap<string, string | null>};
export type TaskNotifyInput = {workId: string; taskId: string; artifacts: ArtifactNotifyInput[]};

/** 一条待发的通知：（Task、提问者会话）一条。`answers` 是还没办完、晚于启用时刻的；`legacy` 是早于启用时刻的（只能手动发）。 */
export type NotifyJob = {
    workId: string;
    taskId: string;
    sessionKey: string;
    answers: Array<{answerId: string; artifactId: string}>;
    legacy: Array<{answerId: string; artifactId: string}>;
    artifacts: string[];
    /** 这些答复覆盖的、这个会话问的题数。 */
    questions: number;
    /** 手动发送时连旧答复一起：产物与题数（新旧答复里的题去重后计数）。 */
    withLegacy: {artifacts: string[]; questions: number};
    /** 提问时记下的 pane（provenance），判断“会话已更换”用；读不到为 null。 */
    askerPaneId: string | null;
};

/** 答复 id 里的时刻（锁内生成、单调）：`20261013T014907695Z` → ISO。 */
export function answerTime(answerId: string): string | null {
    const match = RECORD_ID_PATTERN.exec(answerId);
    if (!match) return null;
    const stamp = match[1]!;
    return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.${stamp.slice(15, 18)}Z`;
}

/** 办完的（答复、会话）对：结果记录里办完的，加上只有意图、没有结果的（按 `uncertain`）。 */
function doneSet(records: readonly NotifyRecord[]): Set<string> {
    const done = new Set<string>();
    const results = new Set(records.filter((record) => record.result !== "pending").map((record) => record.attemptId));
    for (const record of records) {
        const finished = record.result === "pending" ? !results.has(record.attemptId) : DONE_RESULTS.has(record.result);
        if (!finished) continue;
        // 手动另选的会话发的，也算提问者这一份办完（开发者已经替它找过人）。
        for (const answerId of record.answers) {
            done.add(`${answerId}\0${record.askerKey}`);
            done.add(`${answerId}\0${record.sessionKey}`);
        }
    }
    return done;
}

/**
 * 现算待发的通知。一份答复对提问者 X 算办完，当且仅当：尝试记录里有对 X 办完的结果；或者覆盖它的确认，是 X 自己确认的
 * （确认的 provenance 会话键就是 X）。别的会话的确认不算 X 办完：Task 提问集是几个会话共用的，A 先确认不能吃掉 B 的通知。
 * 确认没有 provenance（换了机器、删了 `.local`）时退回“已确认就算办完”，这时可能漏通知。
 * 只有开发者的答复会通知（代录的是会话自己写的）。
 */
export function computeNotifyJobs(input: {tasks: readonly TaskNotifyInput[]; records: readonly NotifyRecord[]; enabledAt: string}): NotifyJob[] {
    const done = doneSet(input.records);
    const jobs = new Map<string, Omit<NotifyJob, "questions" | "withLegacy"> & {questionIds: Set<string>; allQuestionIds: Set<string>; allArtifacts: string[]}>();
    for (const task of input.tasks) {
        for (const artifact of task.artifacts) {
            const ackedBy = new Map<string, Array<string | null>>();
            for (const ack of artifact.acks) {
                for (const answerId of ack.answers) ackedBy.set(answerId, [...(ackedBy.get(answerId) ?? []), artifact.ackers.get(ack.ackId) ?? null]);
            }
            for (const answer of artifact.answers) {
                if (answer.submittedBy.kind !== "developer") continue;
                const at = answerTime(answer.answerId);
                for (const questionId of Object.keys(answer.values)) {
                    const asker = artifact.askers.get(questionId) ?? null;
                    if (asker === null) continue;
                    if (done.has(`${answer.answerId}\0${asker}`)) continue;
                    const ackers = ackedBy.get(answer.answerId) ?? [];
                    if (ackers.some((acker) => acker === null || acker === asker)) continue;
                    const key = `${task.workId}\0${task.taskId}\0${asker}`;
                    let job = jobs.get(key);
                    if (!job) {
                        job = {workId: task.workId, taskId: task.taskId, sessionKey: asker, answers: [], legacy: [], artifacts: [], askerPaneId: artifact.askerPanes.get(questionId) ?? null, questionIds: new Set(), allQuestionIds: new Set(), allArtifacts: []};
                        jobs.set(key, job);
                    }
                    const entry = {answerId: answer.answerId, artifactId: artifact.artifactId};
                    const list = at !== null && at >= input.enabledAt ? job.answers : job.legacy;
                    if (!list.some((existing) => existing.answerId === entry.answerId)) list.push(entry);
                    if (list === job.answers) {
                        job.questionIds.add(`${artifact.artifactId}#${questionId}`);
                        if (!job.artifacts.includes(artifact.artifactId)) job.artifacts.push(artifact.artifactId);
                    }
                    job.allQuestionIds.add(`${artifact.artifactId}#${questionId}`);
                    if (!job.allArtifacts.includes(artifact.artifactId)) job.allArtifacts.push(artifact.artifactId);
                    job.askerPaneId ??= artifact.askerPanes.get(questionId) ?? null;
                }
            }
        }
    }
    return [...jobs.values()].map(({questionIds, allQuestionIds, allArtifacts, ...job}) => ({...job, questions: questionIds.size, withLegacy: {artifacts: allArtifacts, questions: allQuestionIds.size}}));
}

/**
 * 指针消息：一行，不放答复正文。与根 `AGENTS.md` 里 `[nbdev]` 那一句逐字对应（两条命令的白名单）。按括号里列出的产物逐个读、
 * 逐个确认：Task 级的 `answers --json` 会列出没有答复的产物（报告、未答的提问集），对它们 `ack` 报 `no_answers`，输出也成倍变长
 * （t11 实现审查第 3 条）。读答复不带 `--unacked`：别的会话先确认之后，这个会话照样读得到与自己有关的答复（设计审查 I2）。
 */
export function pointerMessage(job: Pick<NotifyJob, "workId" | "taskId" | "artifacts" | "questions">): string {
    const {work, task} = labels(job);
    return `[nbdev] ${work}/${task} 有 ${job.questions} 题新的开发者答复（产物 ${job.artifacts.join("、")}）。${readAndAck(work, task)}`;
}

/**
 * 开发者手动发给“不是提问者”的会话（会话已更换后的新会话、持有租约的会话）时预填的普通消息：不带 `[nbdev]`，
 * 按开发者亲手发的普通用户消息处理。`[nbdev]` 规则只认提问者，不能为这两条路径放宽（t11 实现审查第 2 条）。开发者发之前可以改。
 */
export function developerMessage(job: Pick<NotifyJob, "workId" | "taskId" | "artifacts" | "questions">): string {
    const {work, task} = labels(job);
    return `开发者在面板上答复了 ${work}/${task} 的提问（产物 ${job.artifacts.join("、")}，共 ${job.questions} 题）。请${readAndAck(work, task)}`;
}

function labels(job: Pick<NotifyJob, "workId" | "taskId">): {work: string; task: string} {
    return {work: workNumberLabel(parseWorkId(job.workId)?.number ?? 0), task: taskNumberLabel(parseTaskId(job.taskId)?.number ?? 0)};
}

function readAndAck(work: string, task: string): string {
    return `对括号里列出的每个产物，运行 nbdev answers ${work} ${task} <产物> --json 读答复并把决定写进 Task 记录；再运行 nbdev answers ack ${work} ${task} <产物> --through <该次输出里的 cursor>。`;
}

/** 读一个 Task 的通知输入：只读有开发者答复的产物；提问者与确认者从 provenance 读（只读，不改任何文件）。 */
export async function readTaskNotifyInput(mainRoot: string, workId: string, taskId: string, warnings: Warning[]): Promise<TaskNotifyInput> {
    const artifacts: ArtifactNotifyInput[] = [];
    for (const artifactId of await listArtifactIds(mainRoot, workId, taskId)) {
        const ref: ArtifactRef = {workId, taskId, artifactId};
        const snapshot = await readArtifact(mainRoot, ref);
        warnings.push(...snapshot.warnings);
        const answers = snapshot.answers.filter((answer) => answer.submittedBy.kind === "developer");
        if (answers.length === 0 || !snapshot.latest) continue;
        const askers = new Map<string, string | null>();
        const askerPanes = new Map<string, string | null>();
        const since = new Map(snapshot.latest.questions.map((question) => [question.id, question.since]));
        for (const questionId of new Set(answers.flatMap((answer) => Object.keys(answer.values)))) {
            const version = since.get(questionId);
            const provenance = version === undefined ? null : await verifiedProvenance(mainRoot, versionPath(ref, version), warnings);
            askers.set(questionId, provenance?.session.key ?? null);
            askerPanes.set(questionId, provenance?.session.herdr?.paneId ?? null);
        }
        const ackers = new Map<string, string | null>();
        for (const ack of snapshot.acks) ackers.set(ack.ackId, (await verifiedProvenance(mainRoot, ackPath(ref, ack.ackId), warnings))?.session.key ?? null);
        artifacts.push({artifactId, answers, acks: snapshot.acks, askers, askerPanes, ackers});
    }
    return {workId, taskId, artifacts};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 写一份尝试或选择记录：独占创建，目录 700、文件 600（与租约目录同样的写法）。 */
export async function writeNotifyRecord(mainRoot: string, record: Omit<NotifyRecord, "schema">): Promise<NotifyRecord> {
    const dir = resolve(mainRoot, NOTIFY_ROOT);
    await mkdir(dir, {recursive: true, mode: 0o700});
    await chmod(dir, 0o700);
    const full: NotifyRecord = {schema: NOTIFY_SCHEMA, ...record};
    const name = `${record.at.replace(/[-:.]/gu, "")}-${record.attemptId}-${record.result === "pending" ? "intent" : "result"}.json`;
    try {
        await writeFile(resolve(dir, name), `${JSON.stringify(full, null, 4)}\n`, {mode: 0o600, flag: "wx"});
    } catch (error) {
        throw new NbdevError("write_failed", `写通知记录失败：${error instanceof Error ? error.message : String(error)}`, {cause: error, details: {name}});
    }
    return full;
}

export function newAttemptId(): string {
    return randomBytes(6).toString("hex");
}

/** 读全部记录；读不出的跳过并给警告（只影响去重与历史，不影响答复）。 */
export async function readNotifyRecords(mainRoot: string, warnings: Warning[]): Promise<NotifyRecord[]> {
    const dir = resolve(mainRoot, NOTIFY_ROOT);
    let names: string[];
    try {
        names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return [];
        throw error;
    }
    const records: NotifyRecord[] = [];
    for (const name of names) {
        try {
            const value = JSON.parse(await readFile(resolve(dir, name), "utf8")) as unknown;
            if (!isRecord(value) || value.schema !== NOTIFY_SCHEMA || typeof value.attemptId !== "string" || typeof value.sessionKey !== "string" || !Array.isArray(value.answers)) {
                warnings.push({code: "unreadable_notify_record", message: `通知记录的格式不对，已跳过：${name}`, details: {name}});
                continue;
            }
            records.push({...(value as NotifyRecord), askerKey: typeof value.askerKey === "string" ? value.askerKey : value.sessionKey as string});
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") continue;
            if (!(error instanceof SyntaxError)) throw error;
            warnings.push({code: "unreadable_notify_record", message: `通知记录读不出，已跳过：${name}`, details: {name}});
        }
    }
    return records;
}
