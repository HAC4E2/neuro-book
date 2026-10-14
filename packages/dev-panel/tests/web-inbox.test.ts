import {describe, expect, test} from "bun:test";
import {groupInbox} from "../src/web/host/inbox.js";
import type {InboxItem} from "../src/web/host/types.js";

/** 首页收件箱按产物合并提问（t15 阶段 4 第 1 批）。 */
const question = (artifactId: string, questionId: string, askedBy: string | null = null, askerActive: boolean | null = null): InboxItem => ({kind: "question", workId: "w1", taskId: "t1", artifactId, artifactTitle: artifactId === "uxq" ? "侧栏宽度方案" : null, questionId, label: questionId, type: "single", version: 1, since: 1, askedBy, askerActive});

describe("收件箱按产物合并", () => {
    test("同一产物的题合成一行，按第一次出现的位置排；撞号照旧一条一行；提问的会话去重，有一道还在就算在", () => {
        const rows = groupInbox([
            question("uxq", "q1", "claude:a", false),
            {kind: "number_conflict", label: "w00003/t05", live: false},
            question("review", "r1"),
            question("uxq", "q2", "claude:a", true),
            question("uxq", "q3", "claude:b", null),
        ]);
        expect(rows.map((row) => (row.kind === "artifact" ? [row.artifactId, row.title, row.questions.map((item) => item.questionId), row.askers] : [row.label]))).toEqual([
            ["uxq", "侧栏宽度方案", ["q1", "q2", "q3"], [{key: "claude:a", active: true}, {key: "claude:b", active: null}]],
            ["w00003/t05"],
            ["review", null, ["r1"], []],
        ]);
    });
});
