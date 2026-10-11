/**
 * ProjectInfoDialog（同名 .md）：新建时的“位置”行随书名生成文件夹名、没设作品目录时提示并把按钮改成“选择…”；
 * 主题色新建时也能指定、未指定时不画取色器；提交去掉书名首尾空白并带主题色。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import ProjectInfoDialog from "./ProjectInfoDialog.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

/** 对话框经 Teleport 挂到 body 上，所以查 document.body。 */
function open(props: {mode?: "create" | "edit"; library?: string | null; initial?: {title: string; description: string; color: string | null}} = {}) {
    const wrapper = mount(ProjectInfoDialog, {
        props: {locale: "zh-CN" as const, open: true, mode: props.mode ?? "create", library: props.library === undefined ? "/home/writer/Documents/NeuroBook" : props.library, ...(props.initial === undefined ? {} : {initial: props.initial})},
        attachTo: document.body,
    });
    mounted.push(wrapper);
    return wrapper;
}

const query = <T extends Element>(selector: string): T => {
    const found = document.body.querySelector<T>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};
const textOf = (selector: string): string => (document.body.querySelector(selector)?.textContent ?? "").replace(/\s+/g, "");
const buttonNamed = (name: string): HTMLButtonElement => {
    const found = [...document.body.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);
    if (found === undefined) throw new Error(`没有按钮 ${name}`);
    return found;
};

async function typeTitle(value: string): Promise<void> {
    const input = query<HTMLInputElement>("[data-project-title]");
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await flushPromises();
}

describe("ProjectInfoDialog", () => {
    it("新建时的位置行：书名空着写 <书名>，填了书名按目录名规则生成；“更改…”发 change-location", async () => {
        const wrapper = open();
        await flushPromises();
        expect(textOf("[data-project-location]")).toContain("/home/writer/Documents/NeuroBook/<书名>");
        await typeTitle("  长夜行  ");
        expect(textOf("[data-project-location]")).toContain("/home/writer/Documents/NeuroBook/长夜行");
        query<HTMLButtonElement>("[data-project-change-location]").click();
        expect(wrapper.emitted("change-location")).toHaveLength(1);
    });

    it("没设作品目录时写明要先选、按钮是“选择…”；编辑时没有位置行", async () => {
        open({library: null});
        await flushPromises();
        expect(textOf("[data-project-location]")).toContain("还没有作品目录");
        expect(textOf("[data-project-change-location]")).toBe("选择…");
        document.body.innerHTML = "";
        mounted.splice(0).forEach((wrapper) => wrapper.unmount());

        open({mode: "edit", initial: {title: "北方以北", description: "", color: null}});
        await flushPromises();
        expect(document.body.querySelector("[data-project-location]")).toBeNull();
    });

    it("主题色：未指定时只有“指定主题色…”，指定后出现色值与“不指定”；提交带去掉首尾空白的书名与主题色", async () => {
        const wrapper = open();
        await flushPromises();
        expect(document.body.querySelector("[data-project-color]")).toBeNull();
        query<HTMLButtonElement>("[data-project-set-color]").click();
        await flushPromises();
        expect(textOf("[data-project-color]")).toBe("#3b82f6");
        await typeTitle(" 雾中城 ");
        buttonNamed("新建").click();
        await flushPromises();
        expect(wrapper.emitted("submit")?.[0]).toEqual([{title: "雾中城", description: "", color: "#3b82f6"}]);

        query<HTMLButtonElement>("[data-project-clear-color]").click();
        await flushPromises();
        expect(document.body.querySelector("[data-project-color]")).toBeNull();
        buttonNamed("新建").click();
        await flushPromises();
        expect(wrapper.emitted("submit")?.[1]).toEqual([{title: "雾中城", description: "", color: null}]);
    });
});
