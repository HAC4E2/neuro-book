/**
 * BookshelfPage（同名 .md）：`focusShelf()` 把焦点交回书架（docs/specs/workbench/bookshelf.md 输出 14）；右上角的齿轮打开设置、
 * 设置窗口开着时按下（输出 1）。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import type {ShelfItem} from "../../shared/shelf";
import BookshelfPage from "./BookshelfPage.vue";

const NOW = "2026-10-11T12:00:00.000Z";

function item(id: string, title: string): ShelfItem {
    return {
        id, name: id, title, description: "简介", color: null, cover: null, path: `/books/${id}`, state: "stopped",
        stats: {freshness: "none", computedAt: null, words: 0, files: 0, unreadable: 0, today: null, last: null},
    };
}

function mountPage(items: ShelfItem[], view: "cards" | "list", settingsOpen = false) {
    return mount(BookshelfPage, {
        props: {locale: "zh-CN" as const, status: "ready" as const, items, now: NOW, view, sort: "recent" as const, activeId: null, library: "/home/writer/Documents/NeuroBook", coverSrc: () => null, settingsOpen},
        attachTo: document.body,
    });
}

describe("BookshelfPage", () => {
    it("focusShelf：卡片视图给列表框，列表视图给第一行，空书架给“新建作品”；工具栏在前也不抢", async () => {
        const cards = mountPage([item("a", "甲"), item("b", "乙")], "cards");
        cards.vm.focusShelf();
        expect(document.activeElement?.matches("[data-shelf-cards][role='listbox']")).toBe(true);
        cards.unmount();

        const list = mountPage([item("a", "甲"), item("b", "乙")], "list");
        list.vm.focusShelf();
        expect(document.activeElement?.closest("[data-shelf-row]")).not.toBeNull();
        list.unmount();

        const empty = mountPage([], "cards");
        empty.vm.focusShelf();
        expect(document.activeElement?.matches("[data-shelf-create]")).toBe(true);
        empty.unmount();
    });

    it("右上角是齿轮按钮（不是菜单），紧挨在头像位左边：点了发 open-settings；设置窗口开着时按下", async () => {
        const page = mountPage([item("a", "甲")], "cards");
        const gear = page.get("[data-shelf-settings]");
        expect(gear.attributes("aria-label")).toBe("设置");
        expect(gear.attributes("aria-haspopup")).toBeUndefined();
        expect(gear.attributes("aria-pressed")).toBe("false");
        expect(gear.element.nextElementSibling?.getAttribute("title")).toBe("个人资料尚未开放");
        await gear.trigger("click");
        expect(page.emitted("open-settings")).toEqual([[]]);
        expect(document.body.querySelector("[role='menu']")).toBeNull();
        await page.setProps({settingsOpen: true});
        expect(page.get("[data-shelf-settings]").attributes("aria-pressed")).toBe("true");
        page.unmount();
    });
});
