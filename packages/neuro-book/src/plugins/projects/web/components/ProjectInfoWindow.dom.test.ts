/**
 * ProjectInfoWindow（同名 .md）：新建时的位置行随书名生成文件夹名、服务端的字段错误显示在字段下；主题色用色板；
 * 提交交出去掉首尾空白的书名、主题色、位置与封面变化；本地校验不过不提交。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import ProjectInfoWindow from "./ProjectInfoWindow.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

type Props = Partial<InstanceType<typeof ProjectInfoWindow>["$props"]>;

/** 窗口经 Teleport 挂到 body 上，所以查 document.body。 */
function open(props: Props = {}) {
    const wrapper = mount(ProjectInfoWindow, {
        props: {locale: "zh-CN" as const, open: true, mode: "create" as const, location: "/home/writer/Documents/NeuroBook", ...props},
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

async function type(selector: string, value: string): Promise<void> {
    const input = query<HTMLInputElement>(selector);
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await flushPromises();
}

describe("ProjectInfoWindow", () => {
    it("新建：文件夹名随书名作路径后缀；“浏览…”发 browse-location；提交带位置、书名与色板的颜色", async () => {
        const wrapper = open();
        await flushPromises();
        expect(document.body.querySelector("[data-project-folder]")).toBeNull();
        await type("[data-project-title] input, input[data-project-title]", "  长夜行  ");
        expect(textOf("[data-project-folder]")).toBe("/长夜行");
        query<HTMLButtonElement>("[data-project-browse]").click();
        expect(wrapper.emitted("browse-location")).toHaveLength(1);
        query<HTMLElement>("[data-project-color] [data-color-swatch='#6b2032']").click();
        await flushPromises();
        query<HTMLButtonElement>("[data-project-confirm]").click();
        await flushPromises();
        expect(wrapper.emitted("submit")?.[0]).toEqual([{title: "长夜行", description: "", color: "#6b2032", parent: "/home/writer/Documents/NeuroBook", cover: {kind: "keep"}}]);
    });

    it("书名空着不提交并在字段下说明；服务端的字段错误显示在对应字段下；编辑时没有位置行", async () => {
        const wrapper = open();
        await flushPromises();
        query<HTMLButtonElement>("[data-project-confirm]").click();
        await flushPromises();
        expect(wrapper.emitted("submit")).toBeUndefined();
        expect(document.body.textContent).toContain("书名不能为空");
        await wrapper.setProps({fieldErrors: {location: "作品目录不可用：目录不可读写"}});
        expect(document.body.textContent).toContain("作品目录不可用");
        // 先卸载再清 body：Teleport 的锚点还在时清掉会让卸载找不到节点。
        mounted.splice(0).forEach((entry) => entry.unmount());
        document.body.innerHTML = "";

        open({mode: "edit", initial: {title: "北方以北", description: "", color: null, coverSrc: null}});
        await flushPromises();
        expect(document.body.querySelector("[data-project-location]")).toBeNull();
        expect(query<HTMLButtonElement>("[data-project-confirm]").textContent?.trim()).toBe("保存");
    });

    it("封面：类型不对或超过 5 MB 时在本地拒绝；通过的随提交交出；“移除封面”交出 remove", async () => {
        const wrapper = open({mode: "edit", initial: {id: "a", title: "甲", description: "", color: null, coverSrc: "data:image/png;base64,"}});
        await flushPromises();
        expect(document.body.querySelector("[data-book-cover] img")).not.toBeNull();
        const input = query<HTMLInputElement>("[data-project-cover-input]");
        const setFiles = (file: File): void => {
            Object.defineProperty(input, "files", {value: [file], configurable: true});
            input.dispatchEvent(new Event("change", {bubbles: true}));
        };
        setFiles(new File([new Uint8Array(10)], "x.svg", {type: "image/svg+xml"}));
        await flushPromises();
        expect(textOf("[data-project-cover-problem]")).toContain("PNG");
        setFiles(new File([new Uint8Array(10)], "y.png", {type: "image/png"}));
        await flushPromises();
        expect(document.body.querySelector("[data-project-cover-problem]")).toBeNull();
        query<HTMLButtonElement>("[data-project-confirm]").click();
        await flushPromises();
        expect(wrapper.emitted("submit")?.[0]?.[0]).toMatchObject({title: "甲", parent: null, cover: {kind: "set", file: expect.any(File)}});

        query<HTMLButtonElement>("[data-project-cover-remove]").click();
        await flushPromises();
        expect(document.body.querySelector("[data-book-cover] img")).toBeNull();
        query<HTMLButtonElement>("[data-project-confirm]").click();
        await flushPromises();
        expect(wrapper.emitted("submit")?.[1]?.[0]).toMatchObject({cover: {kind: "remove"}});
    });
});
