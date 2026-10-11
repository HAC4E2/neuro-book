/** ShelfTitlePage（同名 .md）：统计行的新鲜度说明（docs/specs/workbench/bookshelf.md 输出 6、7）。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import type {ShelfItem} from "../../shared/shelf";
import ShelfTitlePage from "./ShelfTitlePage.vue";

const NOW = "2026-10-11T12:00:00.000Z";
const COUNTED_AT = "2026-10-10T09:00:00.000Z";

function item(freshness: ShelfItem["stats"]["freshness"]): ShelfItem {
    return {
        id: "a", name: "a", title: "长夜行", description: null, color: null, cover: null, path: "/books/a", state: freshness === "counting" ? "running" : "stopped",
        stats: {freshness, computedAt: freshness === "none" ? null : COUNTED_AT, words: 1200, files: 3, unreadable: 0, today: null, last: null},
    };
}

function facts(freshness: ShelfItem["stats"]["freshness"]): string[] {
    const wrapper = mount(ShelfTitlePage, {props: {locale: "zh-CN" as const, now: NOW, item: item(freshness)}});
    const texts = wrapper.findAll(".shelf-title-page__fact").map((fact) => fact.text());
    wrapper.unmount();
    return texts;
}

describe("ShelfTitlePage", () => {
    it("统计行按新鲜度写说明：none 只写“尚未统计”，stale 写“统计于某时”，counting 写“正在统计”，fresh 不加", () => {
        expect(facts("none")).toEqual(["尚未统计，打开后开始统计"]);
        const stale = facts("stale");
        expect(stale).toHaveLength(3);
        expect(stale[2]).toMatch(/^统计于/u);
        const counting = facts("counting");
        expect(counting).toHaveLength(3);
        expect(counting[2]).toBe("正在统计");
        const fresh = facts("fresh");
        expect(fresh).toHaveLength(2);
        expect(fresh.join(" ")).not.toContain("统计");
    });
});
