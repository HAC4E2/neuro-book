import {describe, expect, test} from "bun:test";
import {entryActive, NAV_GROUPS, splitNavWorks} from "../src/web/host/nav.js";
import type {OverviewWork, RecordedValue} from "../src/web/host/types.js";

/** 左栏的描述表与 Work 树的取舍（t15 阶段 2b，D4）。 */
const recorded = <T extends string>(value: T | null, origin: RecordedValue["origin"] = value === null ? "unset" : "recorded"): RecordedValue<T> => ({value, origin});
const work = (workId: string, status: "active" | "done" | "shelved" | null, updated: string | null, origin?: RecordedValue["origin"]) => ({workId, title: workId, status: recorded(status, origin), updated: recorded(updated), tasks: []}) as unknown as OverviewWork;
const NOW = new Date("2026-10-14T12:00:00");

describe("Work 树只列活跃的（D4）", () => {
    test("进行中的都列（不管多久没更新）；未标的只列 30 天内更新过的；完成、搁置、更早的、状态写坏的收进“更多”，各自保持原顺序", () => {
        const works = [
            work("w1", "active", "2026-01-01"),
            work("w2", null, "2026-09-14"),
            work("w3", null, "2026-09-13"),
            work("w4", "done", "2026-10-14"),
            work("w5", "shelved", "2026-10-14"),
            work("w6", null, null),
            work("w7", null, "2026-10-14", "invalid"),
            work("w8", "active", null),
        ];
        const {shown, more} = splitNavWorks(works, NOW);
        expect([shown.map((entry) => entry.workId), more.map((entry) => entry.workId)]).toEqual([["w1", "w2", "w8"], ["w3", "w4", "w5", "w6", "w7"]]);
    });
});

describe("左栏条目的高亮", () => {
    const entry = (key: string) => NAV_GROUPS.flatMap((group) => group.entries).find((item) => item.key === key)!;
    test("首页只在 / 上；其余条目在它下面的页也算，但不认前缀相同的别的路径", () => {
        expect([entryActive(entry("home"), "/"), entryActive(entry("home"), "/work/w1")]).toEqual([true, false]);
        expect([entryActive(entry("sessions"), "/live/sessions"), entryActive(entry("artifacts"), "/artifacts"), entryActive(entry("artifacts"), "/artifactsx")]).toEqual([true, true, false]);
    });
});
