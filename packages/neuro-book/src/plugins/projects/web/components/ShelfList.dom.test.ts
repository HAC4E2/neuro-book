/** ShelfList（同名 .md）：每行的字数、篇数与新鲜度说明（docs/specs/workbench/bookshelf.md 输出 8）。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import type {ShelfItem} from "../../shared/shelf";
import ShelfList from "./ShelfList.vue";

const NOW = "2026-10-11T12:00:00.000Z";
const COUNTED_AT = "2026-10-10T09:00:00.000Z";

function item(id: string, freshness: ShelfItem["stats"]["freshness"]): ShelfItem {
    return {
        id, name: id, title: id, description: null, color: null, path: `/books/${id}`, state: "stopped",
        stats: {freshness, computedAt: freshness === "none" ? null : COUNTED_AT, words: 1200, files: 3, unreadable: 0, today: null, last: null},
    };
}

describe("ShelfList", () => {
    it("每行按新鲜度写说明：none 只写“尚未统计”，stale 在数字后写“统计于某时”，counting 写“正在统计”，fresh 不加", () => {
        const wrapper = mount(ShelfList, {props: {locale: "zh-CN" as const, now: NOW, items: [item("none", "none"), item("stale", "stale"), item("counting", "counting"), item("fresh", "fresh")]}});
        const facts = wrapper.findAll("[data-shelf-row] .shelf-list__facts").map((row) => row.findAll("span").map((fact) => fact.text()));
        expect(facts[0]).toEqual(["尚未统计"]);
        expect(facts[1]).toHaveLength(3);
        expect(facts[1]![2]).toMatch(/^统计于/u);
        expect(facts[2]).toHaveLength(3);
        expect(facts[2]![2]).toBe("正在统计");
        expect(facts[3]).toHaveLength(2);
        expect(facts[3]!.join(" ")).not.toContain("统计");
        wrapper.unmount();
    });
});
