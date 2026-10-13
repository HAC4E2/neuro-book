/**
 * 页面根上的浮层宿主（docs/specs/ui/workbench-shell.md 输出 41，验收 44）：每个浮层各自加载、各自出错。`load()` 失败或组件渲染
 * 出错只让这一个浮层不显示并记诊断，别的浮层照常；浮层撤下后迟到的加载结果不挂、不记失败。交付与撤回走真实内核的部分在
 * `overlays.test.ts`。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, shallowRef} from "vue";
import type {Component} from "vue";

import {createOverlayHost} from "./overlays";
import type {OverlayProvider} from "./overlays";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

const marker = (name: string): Component => defineComponent({name, render: () => h("div", {"data-test-overlay": name})});
const ready = (id: string, component: Component): OverlayProvider => ({id, load: async () => component});

function host(providers: ReadonlyArray<OverlayProvider>) {
    const current = shallowRef<ReadonlyArray<OverlayProvider>>(providers);
    const reports: string[] = [];
    const Host = createOverlayHost({current}, (message) => reports.push(message));
    const wrapper = mount(defineComponent({render: () => h("div", [h(Host)])}));
    mounted.push(wrapper);
    const shown = (): string[] => wrapper.findAll("[data-test-overlay]").map((element) => element.attributes("data-test-overlay") ?? "");
    return {current, reports, wrapper, shown};
}

describe("页面浮层宿主", () => {
    it("每个交付的浮层挂一份，加载完才出现；撤下后卸载", async () => {
        const first = ready("test.a.window", marker("A"));
        const {current, shown} = host([first, ready("test.b.window", marker("B"))]);
        await flushPromises();
        expect(shown()).toEqual(["A", "B"]);
        current.value = [first];
        await flushPromises();
        expect(shown()).toEqual(["A"]);
    });

    it("load() 失败只让这一个浮层不显示并记诊断，别的照常", async () => {
        const {reports, shown} = host([
            {id: "test.broken.window", load: async () => {
                throw new Error("模块下载失败");
            }},
            ready("test.good.window", marker("Good")),
        ]);
        await flushPromises();
        expect(shown()).toEqual(["Good"]);
        expect(reports).toEqual(["浮层 test.broken.window 加载失败：模块下载失败"]);
    });

    it("组件渲染出错只卸下这一个浮层并记诊断，页面与别的浮层照常", async () => {
        const Broken = defineComponent({name: "Broken", render: () => {
            throw new Error("算不出来");
        }});
        const {reports, shown, wrapper} = host([ready("test.broken.window", Broken), ready("test.good.window", marker("Good"))]);
        await flushPromises();
        expect(shown()).toEqual(["Good"]);
        expect(reports).toEqual(["浮层 test.broken.window 出错，已卸下：算不出来"]);
        expect(wrapper.exists()).toBe(true);
    });

    it("撤下之后才回来的加载结果不挂，也不记失败", async () => {
        const pending: {resolve: ((component: Component) => void) | null} = {resolve: null};
        const late: OverlayProvider = {id: "test.late.window", load: () => new Promise<Component>((resolve) => {
            pending.resolve = resolve;
        })};
        const {current, reports, shown} = host([late]);
        await flushPromises();
        current.value = [];
        await flushPromises();
        pending.resolve!(marker("Late"));
        await flushPromises();
        expect(shown()).toEqual([]);
        expect(reports).toEqual([]);
    });

    it("同一个浮层重新交付（换了对象）时重新加载", async () => {
        let loads = 0;
        const delivery = (): OverlayProvider => ({id: "test.a.window", load: async () => {
            loads += 1;
            return marker(`A${String(loads)}`);
        }});
        const {current, shown} = host([delivery()]);
        await flushPromises();
        expect(shown()).toEqual(["A1"]);
        current.value = [delivery()];
        await flushPromises();
        expect(shown()).toEqual(["A2"]);
    });
});
