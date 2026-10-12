import {describe, expect, test} from "bun:test";
import {NbdevError} from "./errors.js";
import {formatTaskId, formatWorkId, parseTaskId, parseWorkId, taskRefNumber, workRefNumber} from "./ids.js";

describe("编号格式", () => {
    test("Task 序号 01–99 两位、100 起三位，拒绝 00、000、前导零的三位与四位", () => {
        for (const id of ["t01-a", "t09-a", "t10-a", "t99-a", "t100-a", "t101-a", "t999-a"]) expect(parseTaskId(id)).not.toBeNull();
        for (const id of ["t00-a", "t000-a", "t001-a", "t050-a", "t1-a", "t1000-a", "t01", "t01-A", "t01-a--b"]) expect(parseTaskId(id)).toBeNull();
        expect(parseTaskId("t100-first-three")).toEqual({id: "t100-first-three", number: 100, slug: "first-three"});
    });

    test("Work 序号五位非零", () => {
        expect(parseWorkId("w00022-dev-panel")).toEqual({id: "w00022-dev-panel", number: 22, slug: "dev-panel"});
        for (const id of ["w00000-a", "w0001-a", "w000001-a", "w00001"]) expect(parseWorkId(id)).toBeNull();
    });

    test("格式化与上限", () => {
        expect(formatWorkId(23, "x")).toBe("w00023-x");
        expect(formatTaskId(7, "x")).toBe("t07-x");
        expect(formatTaskId(100, "x")).toBe("t100-x");
        expect(() => formatTaskId(1000, "x")).toThrow(NbdevError);
        expect(() => formatWorkId(100_000, "x")).toThrow(NbdevError);
        expect(() => formatTaskId(1, "Bad_Slug")).toThrow(expect.objectContaining({code: "invalid_slug"}));
    });

    test("引用可以只写编号", () => {
        expect(workRefNumber("w00022")).toBe(22);
        expect(workRefNumber("w00022-dev-panel")).toBe(22);
        expect(workRefNumber("w22")).toBeNull();
        expect(taskRefNumber("t06")).toBe(6);
        expect(taskRefNumber("t100")).toBe(100);
        expect(taskRefNumber("t050")).toBeNull();
    });
});
