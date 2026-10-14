import {describe, expect, test} from "bun:test";
import {ApiError} from "../src/web/host/api.js";
import {describeFailure, failureNotice, fieldProblems, successNotice} from "../src/web/host/writes.js";

/** 写入结果的两层（t15 阶段 3c）：结果的颜色只由结果决定，警告是附注；字段错误只报一次；明细与 message 去重。 */
const warning = (message: string) => ({code: "w", message});
const failure = (status: number, code: string, message: string, details: Record<string, unknown> = {}, warnings: Array<{code: string; message: string}> = []) => describeFailure(new ApiError(status, code, message, details, null, warnings));

describe("成功的结果", () => {
    test("带警告的成功仍是 success，警告进附注；没变时写“内容没变，没有提交”", () => {
        const body = {schema: "x", ok: true, data: {changed: true, commit: {committed: true, sha: "0123456789abcdef", reason: null}}, warnings: [warning("有 1 处撞号")], errors: [], instance: "i", revisions: {}};
        expect(successNotice("已新建 w1 与 t01", body as never)).toEqual({outcome: "success", title: "已新建 w1 与 t01", message: "已提交 012345678", items: [], notes: ["有 1 处撞号"], retry: false});
        const same = {...body, data: {changed: false, commit: {committed: false, sha: "", reason: "nothing_to_commit"}}, warnings: []};
        expect(successNotice("已保存", same as never)).toMatchObject({outcome: "success", message: "内容没变，没有提交", notes: []});
    });
});

describe("失败的结果", () => {
    test("结果按失败的处理方式分：冲突、结果未知、失败（只有确定没写的给重试）", () => {
        expect(failureNotice("没有保存", failure(409, "hash_mismatch", "改过了"))).toMatchObject({outcome: "conflict", retry: false});
        expect(failureNotice("没有保存", failure(409, "uncommitted_changes", "有别人的改动"))).toMatchObject({outcome: "conflict", retry: false});
        expect(failureNotice("结果未知", failure(0, "network", "连不上"))).toMatchObject({outcome: "unknown", retry: false});
        expect(failureNotice("没有改", failure(503, "lock_timeout", "等锁超时"))).toMatchObject({outcome: "failure", retry: true});
        expect(failureNotice("没有改", failure(400, "usage", "不对"))).toMatchObject({outcome: "failure", retry: false});
    });

    test("编辑页改了 taskId：原因只出现一次（明细里与 message 相同的不再列）；服务端的警告进附注", () => {
        const notice = failureNotice("没有保存", failure(400, "usage", "不能改 taskId", {problems: [{field: "taskId", reason: "不能改 taskId"}, {field: "status", reason: "改状态要用状态切换"}]}, [warning("登记表有 1 处撞号")]));
        expect(notice).toEqual({outcome: "failure", title: "没有保存", message: "不能改 taskId", items: ["status：改状态要用状态切换"], notes: ["登记表有 1 处撞号"], retry: false});
    });

    test("已写入没提交的路径：message 里写了就不再列一遍", () => {
        const notice = failureNotice("没有保存", failure(500, "commit_failed", "x", {writtenPaths: [".agents/works/w1/README.md"]}));
        expect([notice.message.includes(".agents/works/w1/README.md"), notice.items]).toEqual([true, []]);
    });

    test("新建页：能锚到表单字段的问题只在字段旁边报，结果里写“表单里标出了 N 处”；锚不到的仍进明细", () => {
        const raw = failure(400, "usage", "目标不能为空", {field: "goal", problems: [{field: "slug", reason: "短名已被占用"}, {field: "preview", reason: "预览失败"}]});
        expect(fieldProblems(raw)).toEqual([{field: "slug", message: "短名已被占用"}, {field: "preview", message: "预览失败"}, {field: "goal", message: "目标不能为空"}]);
        const notice = failureNotice("没有新建", raw, new Set(["slug", "goal"]));
        expect([notice.message, notice.items]).toEqual(["表单里标出了 2 处要改的地方", ["preview：预览失败"]]);
    });

    test("产物页：答复被拒的原因按题号锚到题目下面，不在结果里再拼一遍、再列一遍；表单里没有的题仍进明细", () => {
        const raw = failure(400, "invalid_answer", "q1：要选一项；q2：超出范围；q9：题已撤回", {problems: [{questionId: "q1", reason: "要选一项"}, {questionId: "q2", reason: "超出范围"}, {questionId: "q9", reason: "题已撤回"}]});
        const notice = failureNotice("答复没有提交", raw, new Set(["q1", "q2"]));
        expect([notice.message, notice.items]).toEqual(["表单里标出了 2 处要改的地方", ["q9：题已撤回"]]);
        const single = failureNotice("答复没有提交", failure(400, "invalid_answer", "要选一项", {questionId: "q1"}), new Set(["q1"]));
        expect([single.message, single.items]).toEqual(["表单里标出了 1 处要改的地方", []]);
    });
});
