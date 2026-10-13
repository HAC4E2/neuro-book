import {afterEach, describe, expect, test} from "bun:test";
import {chmod, readFile, rm, stat} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {submitAnswer} from "../src/core/artifact-ops.js";
import type {AckRecord, AnswerRecord} from "../src/core/artifacts.js";
import {auditPaths, createAuditWriter, initAudit, newActionId, readAuditStatus} from "../src/core/audit.js";
import {computeNotifyJobs, newAttemptId, pointerMessage, readNotifyRecords, readTaskNotifyInput, writeNotifyRecord, type NotifyRecord, type TaskNotifyInput} from "../src/core/notify.js";
import {locateRepository} from "../src/core/repo.js";
import {CLI_PATH, cleanupFixtures, createFixture, run, type CliEnvelope} from "./git-fixture.js";

/** t11 通知与审计的核心（L2）：现算的判据、尝试记录、指针消息、审计的位置、权限与串行写。 */

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    await cleanupFixtures();
});

const ENABLED = "2026-10-13T00:00:00.000Z";
const answer = (answerId: string, values: Record<string, unknown>, kind: "developer" | "agent-transcribed" = "developer"): AnswerRecord => ({
    schema: "nbdev.answer/v1", workId: "w00022-dev-panel", taskId: "t03-design", artifactId: "questions", answerId, artifactVersion: 1, contentHash: null,
    submittedAt: "2026-10-13T08:00:00.000Z", submittedBy: kind === "developer" ? {kind, device: "local"} : {kind}, values, comments: {}, note: null,
});
const ack = (ackId: string, answers: string[]): AckRecord => ({schema: "nbdev.answer-ack/v1", workId: "w00022-dev-panel", taskId: "t03-design", artifactId: "questions", ackId, answers, through: answers.at(-1)!, included: [], ackedAt: "2026-10-13T09:00:00.000Z"});
const A = "claude:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "omp:/sessions/b.jsonl";
const ID1 = "20261013T080000000Z-0000aaaa";
const OLD = "20261012T080000000Z-0000bbbb";

function task(answers: AnswerRecord[], acks: AckRecord[] = [], ackers: Record<string, string | null> = {}): TaskNotifyInput {
    return {workId: "w00022-dev-panel", taskId: "t03-design", artifacts: [{
        artifactId: "questions", answers, acks,
        askers: new Map([["layout", A], ["port", B], ["lost", null]]),
        askerPanes: new Map([["layout", "w1:p16"], ["port", "w1:pV"], ["lost", null]]),
        ackers: new Map(Object.entries(ackers)),
    }]};
}
const record = (sessionKey: string, answers: string[], result: NotifyRecord["result"], attemptId = newAttemptId()): NotifyRecord => ({
    schema: "nbdev.notify/v1", attemptId, at: "2026-10-13T08:01:00.000Z", workId: "w00022-dev-panel", taskId: "t03-design", sessionKey, askerKey: sessionKey, paneId: null, answers, result, code: null, message: null, manual: false,
});
const keys = (jobs: ReturnType<typeof computeNotifyJobs>) => jobs.map((job) => [job.sessionKey, job.answers.map((entry) => entry.answerId), job.legacy.map((entry) => entry.answerId)]).sort();

describe("待发通知的现算", () => {
    test("一份答复答了两个会话问的题：两个会话各一条；代录的与没有提问者的不通知", () => {
        const jobs = computeNotifyJobs({tasks: [task([answer(ID1, {layout: "cards", port: "4400", lost: "x"}), answer("20261013T080500000Z-0000cccc", {layout: "table"}, "agent-transcribed")])], records: [], enabledAt: ENABLED});
        expect(keys(jobs)).toEqual([[A, [ID1], []], [B, [ID1], []]].sort());
        expect(jobs.find((job) => job.sessionKey === A)).toMatchObject({artifacts: ["questions"], questions: 1, askerPaneId: "w1:p16"});
    });

    test("别的会话的确认不算办完；自己的确认算；确认没有 provenance 时退回“已确认就算办完”", () => {
        const answers = [answer(ID1, {layout: "cards", port: "4400"})];
        expect(keys(computeNotifyJobs({tasks: [task(answers, [ack("ack-1", [ID1])], {"ack-1": A})], records: [], enabledAt: ENABLED}))).toEqual([[B, [ID1], []]]);
        expect(keys(computeNotifyJobs({tasks: [task(answers, [ack("ack-1", [ID1])], {"ack-1": null})], records: [], enabledAt: ENABLED}))).toEqual([]);
    });

    test("办完的判据：投递、写进确认界面、换了会话、结果未知、开发者跳过都算；只有意图没有结果的按结果未知算；没写进去的不算", () => {
        const answers = [answer(ID1, {layout: "cards"})];
        for (const result of ["delivered", "delivered_into_blocked", "delivered_maybe_wrong_session", "uncertain", "skipped"] as const) {
            expect([result, keys(computeNotifyJobs({tasks: [task(answers)], records: [record(A, [ID1], result)], enabledAt: ENABLED}))]).toEqual([result, []]);
        }
        expect(keys(computeNotifyJobs({tasks: [task(answers)], records: [record(A, [ID1], "pending")], enabledAt: ENABLED}))).toEqual([]);
        const attemptId = newAttemptId();
        for (const result of ["agent_blocked", "not_deliverable", "session_changed", "failed"] as const) {
            expect([result, keys(computeNotifyJobs({tasks: [task(answers)], records: [record(A, [ID1], "pending", attemptId), record(A, [ID1], result, attemptId)], enabledAt: ENABLED}))]).toEqual([result, [[A, [ID1], []]]]);
        }
    });

    test("早于启用时刻的答复只进 legacy（只能手动发），不计入题数", () => {
        const jobs = computeNotifyJobs({tasks: [task([answer(OLD, {layout: "cards"}), answer(ID1, {port: "4400"})])], records: [], enabledAt: ENABLED});
        expect(keys(jobs)).toEqual([[A, [], [OLD]], [B, [ID1], []]].sort());
        expect(jobs.find((job) => job.sessionKey === A)).toMatchObject({questions: 0, artifacts: [], withLegacy: {artifacts: ["questions"], questions: 1}});
    });

    test("指针消息与根 AGENTS.md 那一句逐字对应：一行、读答复不带 --unacked", () => {
        const text = pointerMessage({workId: "w00022-dev-panel", taskId: "t03-design", artifacts: ["review", "questions"], questions: 4});
        expect(text).toBe("[nbdev] w00022/t03 有 4 题新的开发者答复（产物 review、questions）。运行 nbdev answers w00022 t03 --json 读答复并把决定写进 Task 记录；再对输出里每个产物运行 nbdev answers ack w00022 t03 <产物> --through <该次输出里的 cursor>。");
        expect(text.includes("\n")).toBe(false);
        expect(text.length).toBeLessThan(300);
    });
});

describe("从仓库读", () => {
    test("A、B 在同一个提问集上各问一题，一份答复答两题；B 确认之后 A 仍有通知，B 没有", async () => {
        const fixture = await createFixture("notify-read");
        for (const [as, id] of [["alice", "layout"], ["bob", "port"]] as const) {
            const asked = await fixture.cli(["ask", "w00001", "t01", "--id", id, "--type", "text", "--label", id, "--as", as, "--json"]);
            expect([asked.exitCode, asked.json?.errors]).toEqual([0, []]);
        }
        const context = await locateRepository(fixture.main);
        const answered = await submitAnswer(context, {workRef: "w00001", taskRef: "t01", artifactId: "questions", values: {layout: "卡片", port: "4400"}, submittedBy: {kind: "developer", device: "local"}});
        const answerId = answered.data.answer.answerId;
        const before = await readTaskNotifyInput(fixture.main, "w00001-seed", "t01-seed", []);
        expect(keys(computeNotifyJobs({tasks: [before], records: [], enabledAt: ENABLED}))).toEqual([["external:alice", [answerId], []], ["external:bob", [answerId], []]]);
        const acked = await fixture.cli(["answers", "ack", "w00001", "t01", "questions", "--through", answerId, "--as", "bob", "--json"]);
        expect([acked.exitCode, (acked.json as CliEnvelope).errors]).toEqual([0, []]);
        const after = await readTaskNotifyInput(fixture.main, "w00001-seed", "t01-seed", []);
        expect(keys(computeNotifyJobs({tasks: [after], records: [], enabledAt: ENABLED}))).toEqual([["external:alice", [answerId], []]]);
    });

    test("尝试记录：独占创建，目录 700、文件 600，读回来一样", async () => {
        const fixture = await createFixture("notify-records");
        const written = await writeNotifyRecord(fixture.main, {attemptId: "abc123", at: "2026-10-13T08:01:00.000Z", workId: "w00001-seed", taskId: "t01-seed", sessionKey: A, askerKey: A, paneId: "w1:p1", answers: [ID1], result: "pending", code: null, message: null, manual: false});
        const dir = join(fixture.main, ".local/agent/run/notify");
        expect(((await stat(dir)).mode & 0o777).toString(8)).toBe("700");
        expect(await readNotifyRecords(fixture.main, [])).toEqual([written]);
    });
});

describe("审计", () => {
    test("初始化：目录 700、audit.jsonl 600、init.json 记启用时刻；再初始化不改启用时刻；权限放宽之后不可用", async () => {
        const root = await createTestTmpRoot("dev-panel-audit", "dev-panel audit");
        roots.push(root);
        const paths = auditPaths({XDG_CONFIG_HOME: join(root, "config")});
        expect(await readAuditStatus(paths)).toMatchObject({enabled: false, reason: "not_initialized"});
        const first = await initAudit(paths, new Date("2026-10-13T08:00:00.000Z"));
        expect(first).toEqual({created: true, initAt: "2026-10-13T08:00:00.000Z"});
        expect([((await stat(paths.dir)).mode & 0o777).toString(8), ((await stat(paths.file)).mode & 0o777).toString(8)]).toEqual(["700", "600"]);
        expect(await initAudit(paths, new Date("2026-10-14T08:00:00.000Z"))).toEqual({created: false, initAt: "2026-10-13T08:00:00.000Z"});
        await chmod(paths.file, 0o644);
        expect(await readAuditStatus(paths)).toMatchObject({enabled: false, reason: "bad_mode"});
        await chmod(paths.file, 0o600);
        expect((await readAuditStatus(paths)).enabled).toBe(true);
    });

    test("写：没初始化报 audit_unavailable；并发 20 条串行写成 20 行完整的 JSON，意图与结果共用 actionId", async () => {
        const root = await createTestTmpRoot("dev-panel-audit-write", "dev-panel audit write");
        roots.push(root);
        const paths = auditPaths({XDG_CONFIG_HOME: join(root, "config")});
        const writer = createAuditWriter(paths, "instance-1");
        await expect(writer.append({actionId: newActionId(), phase: "intent", action: "notify", device: "local", target: {}, detail: {}})).rejects.toMatchObject({code: "audit_unavailable"});
        await initAudit(paths);
        const ids = Array.from({length: 10}, () => newActionId());
        await Promise.all(ids.flatMap((actionId) => [
            writer.append({actionId, phase: "intent", action: "prompt", device: "local", target: {paneId: "w1:p1"}, detail: {text: "长".repeat(2000)}}),
            writer.append({actionId, phase: "result", action: "prompt", device: "local", target: {paneId: "w1:p1"}, detail: {result: "delivered"}}),
        ]));
        const lines = (await readFile(paths.file, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as {actionId: string; phase: string; schema: string; instance: string});
        expect(lines.length).toBe(20);
        for (const id of ids) expect(lines.filter((line) => line.actionId === id).map((line) => line.phase).sort()).toEqual(["intent", "result"]);
        expect(lines.every((line) => line.schema === "nbdev.audit/v1" && line.instance === "instance-1")).toBe(true);
    });

    test("包脚本 audit-init 按 XDG_CONFIG_HOME 建目录", async () => {
        const root = await createTestTmpRoot("dev-panel-audit-init", "dev-panel audit init");
        roots.push(root);
        const result = await run(process.execPath, [join(CLI_PATH, "..", "audit-init.ts"), "--json"], root, undefined, 30_000, {XDG_CONFIG_HOME: join(root, "config")});
        expect(result.exitCode).toBe(0);
        expect((JSON.parse(result.stdout) as {data: {created: boolean; dir: string}}).data).toMatchObject({created: true, dir: join(root, "config", "nbdev")});
    });
});
