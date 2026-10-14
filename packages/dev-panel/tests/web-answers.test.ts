import {describe, expect, test} from "bun:test";
import {answerText, groupQuestions, isNewQuestion} from "../src/web/host/answers.js";
import type {QuestionState, VersionQuestion} from "../src/web/host/types.js";

/** 产物页侧栏的分组（t15 阶段 4 第 1 批）：待答、已答、之前几版的题、已取代与撤回。 */
const question = (id: string, patch: Partial<VersionQuestion> = {}): VersionQuestion => ({id, type: "single", label: id, options: [{value: "a", label: "甲"}, {value: "b", label: "乙"}], required: true, recommend: [], origin: "markup", page: "index.html", about: null, since: 1, outcome: null, ...patch});
const answer = (value: unknown) => ({answerId: "x", value, artifactVersion: 1, submittedAt: "2026-10-14T00:00:00.000Z", comment: null});
const state = (q: VersionQuestion, name: QuestionState["state"], value?: unknown): QuestionState => ({question: q, state: name, answer: value === undefined ? null : answer(value), stale: null});

describe("产物页侧栏的分组", () => {
    test("v1 已答、v2 页面上没有的题进“之前几版的题”；ask 登记的题不在页面里照样待答；必答在前", () => {
        const groups = groupQuestions([
            state(question("old", {page: null}), "answered", "a"),
            state(question("optional", {required: false, since: 2}), "open"),
            state(question("asked", {origin: "ask", page: null, since: 2}), "open"),
            state(question("kept", {since: 2}), "answered", "b"),
            state(question("gone", {outcome: {kind: "superseded", in: 2, by: null}}), "superseded"),
        ]);
        const ids = (list: QuestionState[]) => list.map((entry) => entry.question.id);
        expect([ids(groups.pending), ids(groups.answered), ids(groups.earlier), ids(groups.retired)]).toEqual([["asked", "optional"], ["kept"], ["old"], ["gone"]]);
    });

    test("“新”只标最新一版第一次出现的题，第一版不标", () => {
        expect([isNewQuestion({since: 2}, 2), isNewQuestion({since: 1}, 2), isNewQuestion({since: 1}, 1)]).toEqual([true, false, false]);
    });

    test("答案的文字：选项名、多选用顿号、确认题写同意与不同意", () => {
        const multi = question("m", {type: "multi"});
        expect([answerText(question("s"), "b"), answerText(multi, ["a", "b"]), answerText(question("c", {type: "confirm", options: []}), false)]).toEqual(["乙", "甲、乙", "不同意"]);
    });
});
