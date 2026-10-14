/**
 * SettingsPageList（同名 .md，settings-window.md 输出 19）：受控单选；一个 Tab 停靠点，上下键与 Home、End 移动并选中，停用的
 * 跳过；读屏的角色与选中状态。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import SettingsPageList from "./SettingsPageList.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const ITEMS = [
    {id: "deepseek", title: "DeepSeek", description: "api.deepseek.com"},
    {id: "custom", title: "自定义服务", disabledReason: "还没有填写接口地址"},
    {id: "openai", title: "OpenAI"},
];

function list(modelValue: string | null) {
    const wrapper = mount(SettingsPageList, {
        props: {items: ITEMS, modelValue, label: "服务商", "onUpdate:modelValue": (id: string) => wrapper.setProps({modelValue: id})},
        attachTo: document.body,
    });
    mounted.push(wrapper);
    return wrapper;
}

const item = (wrapper: ReturnType<typeof list>, id: string) => wrapper.find(`[data-settings-page-list-item="${id}"]`);

describe("SettingsPageList", () => {
    it("点一条即选中；已选中的与停用的点了不发；读屏是 listbox 与 option", async () => {
        const wrapper = list("deepseek");
        expect(wrapper.attributes("role")).toBe("listbox");
        expect(wrapper.attributes("aria-label")).toBe("服务商");
        expect(item(wrapper, "deepseek").attributes("aria-selected")).toBe("true");
        await item(wrapper, "deepseek").trigger("click");
        await item(wrapper, "custom").trigger("click");
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        expect(item(wrapper, "custom").attributes()).toMatchObject({"aria-disabled": "true", title: "还没有填写接口地址"});
        await item(wrapper, "openai").trigger("click");
        expect(wrapper.emitted("update:modelValue")).toEqual([["openai"]]);
    });

    it("一个 Tab 停靠点：选中项，没有选中时第一条可用的；上下键跳过停用的、到头不循环，Home、End 到首尾，焦点跟着走", async () => {
        const none = list(null);
        expect(item(none, "deepseek").attributes("tabindex")).toBe("0");
        expect(item(none, "openai").attributes("tabindex")).toBe("-1");

        const wrapper = list("deepseek");
        await item(wrapper, "deepseek").trigger("keydown", {key: "ArrowDown"});
        expect(wrapper.props("modelValue")).toBe("openai");
        expect(document.activeElement).toBe(item(wrapper, "openai").element);
        await item(wrapper, "openai").trigger("keydown", {key: "ArrowDown"});
        expect(wrapper.emitted("update:modelValue")).toEqual([["openai"]]);
        await item(wrapper, "openai").trigger("keydown", {key: "Home"});
        expect(wrapper.props("modelValue")).toBe("deepseek");
        await item(wrapper, "deepseek").trigger("keydown", {key: "End"});
        expect(wrapper.props("modelValue")).toBe("openai");
    });
});
