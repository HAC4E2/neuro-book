import {describe, expect, test} from "bun:test";
import {pageKey} from "../src/web/host/routes.js";

/** 页面实例的身份（`host/routes.ts` 的 `pageKey`，L1，t15 阶段 1.9）。 */
describe("pageKey", () => {
    test("同名不同路径参数不等；只差查询参数相等（不在参数里）；参数的键序不影响", () => {
        const taskA = pageKey({name: "task", params: {workId: "w1", taskId: "t1"}});
        expect(pageKey({name: "task", params: {workId: "w1", taskId: "t2"}})).not.toBe(taskA);
        expect(pageKey({name: "task", params: {taskId: "t1", workId: "w1"}})).toBe(taskA);
        expect(pageKey({name: "work", params: {workId: "w1"}})).not.toBe(pageKey({name: "task", params: {workId: "w1"}}));
        expect(pageKey({name: "sessions", params: {}})).toBe(pageKey({name: "sessions", params: {}}));
    });
});
