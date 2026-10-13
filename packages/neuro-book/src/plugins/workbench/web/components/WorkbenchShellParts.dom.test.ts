/**
 * 外壳的受控零件（同名 .md）：活动栏、“移动到”菜单、工具区域的框、视图外框。菜单走 nb-ui Dropdown 的真实原语与键盘路径。
 */

import {mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, onBeforeUnmount} from "vue";

import WorkbenchActivityBar from "./WorkbenchActivityBar.vue";
import WorkbenchMoveViewMenu from "./WorkbenchMoveViewMenu.vue";
import WorkbenchToolPartHost from "./WorkbenchToolPartHost.vue";
import WorkbenchViewActions from "./WorkbenchViewActions.vue";
import WorkbenchViewSection from "./WorkbenchViewSection.vue";

const wrappers: VueWrapper[] = [];

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

async function flush(times = 8): Promise<void> {
    for (let index = 0; index < times; index += 1) await nextTick();
}

const menuItems = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]"));

describe("WorkbenchActivityBar", () => {
    const containers = [{id: "view:a", label: "资源管理器", icon: "i-lucide-files"}, {id: "view:b", label: "搜索", icon: "i-lucide-search"}];

    it("点任何一项都发 select（包括已选中的）；选中标记只在 Sidebar 可见时出现", async () => {
        const wrapper = mount(WorkbenchActivityBar, {props: {label: "活动栏", containers, selected: "view:a", sidebarVisible: true, dragHint: "按空格拿起并拖动"}});
        wrappers.push(wrapper);
        const button = (id: string) => wrapper.get(`[data-activity-container="${id}"]`);
        expect(wrapper.get("nav").attributes("aria-label")).toBe("活动栏");
        expect(button("view:a").attributes("aria-pressed")).toBe("true");
        expect(button("view:b").attributes("aria-pressed")).toBe("false");
        expect(button("view:b").attributes("aria-label")).toBe("搜索");
        await button("view:a").trigger("click");
        await button("view:b").trigger("click");
        expect(wrapper.emitted("select")).toEqual([["view:a"], ["view:b"]]);
        await wrapper.setProps({sidebarVisible: false});
        expect(button("view:a").attributes("aria-pressed")).toBe("false");
    });

    it("底段的全局项按给的顺序排在容器之后；切换按钮按下与否看 pressed；没有命令的是不可点的占位；命令不可用时停用并以原因作提示（输出 40）", async () => {
        const gear = {id: "nbook.settings", title: "设置", icon: "i-lucide-settings", command: {id: "nbook.settings.open", args: {}}, pressed: false, disabledReason: null};
        const items = [{id: "nbook.workbench.profile", title: "个人资料尚未开放", icon: "i-lucide-user-round", command: null, pressed: null, disabledReason: null}, gear];
        const wrapper = mount(WorkbenchActivityBar, {props: {label: "活动栏", containers, selected: "view:a", sidebarVisible: true, dragHint: "按空格拿起并拖动", items}});
        wrappers.push(wrapper);
        expect(wrapper.findAll("[data-activity-container], [data-activity-item]").map((element) => element.attributes("data-activity-container") ?? element.attributes("data-activity-item"))).toEqual(["view:a", "view:b", "nbook.workbench.profile", "nbook.settings"]);

        const profile = wrapper.get("[data-activity-item='nbook.workbench.profile']");
        expect(profile.element.tagName).toBe("SPAN");
        expect(profile.attributes("role")).toBe("img");
        expect(profile.attributes("aria-label")).toBe("个人资料尚未开放");
        expect(profile.attributes("data-activity-item-placeholder")).toBe("");
        await profile.trigger("click");
        expect(wrapper.emitted("run-item")).toBeUndefined();

        const button = () => wrapper.get("[data-activity-item='nbook.settings']");
        expect(button().attributes("aria-label")).toBe("设置");
        expect(button().attributes("aria-pressed")).toBe("false");
        await button().trigger("click");
        expect(wrapper.emitted("run-item")).toEqual([["nbook.settings"]]);
        // 按下态不是“当前容器”：不带强调色的选中类。
        await wrapper.setProps({items: [items[0]!, {...gear, pressed: true}]});
        expect(button().attributes("aria-pressed")).toBe("true");
        expect(button().classes()).toContain("workbench-activity-bar__item--pressed");
        expect(button().classes()).not.toContain("workbench-activity-bar__item--active");

        await wrapper.setProps({items: [items[0]!, {...gear, disabledReason: "命令 nbook.settings.open 不存在"}]});
        expect((button().element as HTMLButtonElement).disabled).toBe(true);
        expect(button().attributes("title")).toBe("命令 nbook.settings.open 不存在");
    });
});

describe("WorkbenchMoveViewMenu", () => {
    const groups = [
        {part: "sidebar", label: "侧栏", targets: [{id: "view:b", label: "搜索", icon: "i-lucide-search"}], createLabel: "新建容器（在侧栏）"},
        {part: "auxiliarybar", label: "右栏", targets: [], createLabel: "新建容器（在右栏）"},
        {part: "panel", label: "面板", targets: [{id: "view:c", label: "终端", icon: "i-lucide-terminal"}], createLabel: "新建容器（在面板）"},
    ];
    const base = {label: "移动到", viewId: "a", sourceContainerId: "view:a", groups, resetLabel: "重置位置", identity: "a|view:a|1|single"};

    async function open(wrapper: VueWrapper): Promise<void> {
        const trigger = wrapper.get("[data-move-view]");
        (trigger.element as HTMLButtonElement).focus();
        await trigger.trigger("keydown", {key: "ArrowDown"});
        await flush();
    }

    function click(label: string): void {
        const item = menuItems().find((candidate) => candidate.textContent?.trim().startsWith(label) === true);
        if (item === undefined) throw new Error(`菜单里没有 ${label}`);
        item.click();
    }

    it("一层平铺列出目标，右侧注明 Part，每段末尾是新建容器；选中后发 move，来源是打开时记下的；重置位置发 reset", async () => {
        const wrapper = mount(WorkbenchMoveViewMenu, {props: base, attachTo: document.body});
        wrappers.push(wrapper);
        await open(wrapper);
        expect(menuItems().map((item) => item.textContent?.replace(/\s+/gu, ""))).toEqual(["搜索侧栏", "新建容器（在侧栏）", "新建容器（在右栏）", "终端面板", "新建容器（在面板）", "重置位置"]);
        click("终端");
        await flush();
        expect(wrapper.emitted("move")).toEqual([[{viewId: "a", sourceContainerId: "view:a", targetContainerId: "view:c"}]]);

        await open(wrapper);
        click("新建容器（在右栏）");
        await flush();
        expect(wrapper.emitted("move")?.[1]).toEqual([{viewId: "a", sourceContainerId: "view:a", newContainerIn: "auxiliarybar"}]);

        await open(wrapper);
        click("重置位置");
        await flush();
        expect(wrapper.emitted("reset")).toEqual([["a"]]);
    });

    it("菜单开着时身份变了：菜单关闭，不发事件", async () => {
        const wrapper = mount(WorkbenchMoveViewMenu, {props: base, attachTo: document.body});
        wrappers.push(wrapper);
        await open(wrapper);
        expect(menuItems().length).toBeGreaterThan(0);
        await wrapper.setProps({sourceContainerId: "view:b", identity: "a|view:b|1|multiple"});
        await flush();
        expect(menuItems()).toEqual([]);
        expect(wrapper.emitted("move")).toBeUndefined();
    });

    it("没有目标也不能重置：按钮禁用", () => {
        const wrapper = mount(WorkbenchMoveViewMenu, {props: {...base, groups: [], resetLabel: null}});
        wrappers.push(wrapper);
        expect(wrapper.get("[data-move-view]").attributes("disabled")).toBeDefined();
    });
});

describe("WorkbenchViewActions", () => {
    const entry = (key: string, title: string, extra: {disabledReason?: string; pressed?: boolean; icon?: string | null} = {}) => ({key, command: `test.${key}`, title, icon: extra.icon === undefined ? "i-lucide-square" : extra.icon, disabledReason: extra.disabledReason ?? null, ...(extra.pressed === undefined ? {} : {pressed: extra.pressed})});
    const model = {
        buttons: [entry("own:0", "刷新")],
        menu: [[entry("own:1", "显示隐藏文件", {pressed: true, icon: null})], [entry("acme.export", "导出", {disabledReason: "没有选中的章节"}), entry("acme.copy", "复制路径")]],
    };
    const props = {model, identity: "a|view:a|single|published|1", moreLabel: "更多操作"};
    const all = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>("[role^=menuitem]"));

    async function openMore(wrapper: VueWrapper): Promise<void> {
        const trigger = wrapper.get("[data-view-actions-more]");
        (trigger.element as HTMLButtonElement).focus();
        await trigger.trigger("keydown", {key: "ArrowDown"});
        await flush();
    }

    it("按钮点了发 run（key）；“⋯”按节列出、节间一条分隔线，勾选项带 aria-checked，禁用项带原因；选中发 run", async () => {
        const wrapper = mount(WorkbenchViewActions, {props, attachTo: document.body});
        wrappers.push(wrapper);
        await wrapper.get('[data-view-action-key="own:0"]').trigger("click");
        expect(wrapper.emitted("run")).toEqual([["own:0"]]);
        expect(wrapper.get("[data-view-actions-more]").attributes("aria-label")).toBe("更多操作");
        await openMore(wrapper);
        expect(all().map((item) => [item.textContent?.trim(), item.getAttribute("role"), item.getAttribute("aria-checked"), item.getAttribute("aria-disabled")])).toEqual([
            ["显示隐藏文件", "menuitemcheckbox", "true", null],
            ["导出", "menuitem", null, "true"],
            ["复制路径", "menuitem", null, null],
        ]);
        expect(document.querySelectorAll("[role=separator]").length).toBe(1);
        all().find((item) => item.textContent?.trim() === "复制路径")!.click();
        await flush();
        expect(wrapper.emitted("run")?.[1]).toEqual(["acme.copy"]);
    });

    it("“⋯”开着时身份变了：菜单关闭，之前的选择不执行；没有菜单项时不画“⋯”", async () => {
        const wrapper = mount(WorkbenchViewActions, {props, attachTo: document.body});
        wrappers.push(wrapper);
        await openMore(wrapper);
        expect(all().length).toBe(3);
        await wrapper.setProps({identity: "a|view:a|single|published|2"});
        await flush();
        expect(all()).toEqual([]);
        expect(wrapper.emitted("run")).toBeUndefined();
        await wrapper.setProps({model: {buttons: model.buttons, menu: []}});
        expect(wrapper.find("[data-view-actions-more]").exists()).toBe(false);
    });
});

describe("WorkbenchToolPartHost", () => {
    const base = {locale: "zh-CN" as const, label: "右栏", emptyText: "将视图拖动到此处显示", idPrefix: "t", dragLabel: "拖动 {title}", dragHint: "按空格拿起并拖动"};

    it("右栏没有容器：标签带仍在（落点），不出现空的 tablist；空正文显示说明", () => {
        const wrapper = mount(WorkbenchToolPartHost, {props: {...base, part: "auxiliarybar", presentation: {switcher: [], selected: null, axis: "vertical"}, selected: null}});
        wrappers.push(wrapper);
        expect(wrapper.find("[data-switcher-band='auxiliarybar']").exists()).toBe(true);
        expect(wrapper.find("[role='tablist']").exists()).toBe(false);
        expect(wrapper.get("[data-empty-part='auxiliarybar']").text()).toBe("将视图拖动到此处显示");
    });

    it("右栏有容器：标签在标签带里", () => {
        const switcher = [{containerId: "view:a", title: {"zh-CN": "甲", "en-US": "A"}, icon: "i-a"}];
        const wrapper = mount(WorkbenchToolPartHost, {props: {...base, part: "auxiliarybar", presentation: {switcher, selected: "view:a", axis: "vertical"}, selected: null}});
        wrappers.push(wrapper);
        expect(wrapper.get("[data-switcher-band='auxiliarybar']").find("[role='tab']").text()).toBe("甲");
    });
});

describe("WorkbenchViewSection", () => {
    const base = {viewId: "a", title: "资源管理器", icon: "i-lucide-files", axis: "vertical" as const, chrome: true, collapsed: false, layout: "scroll" as const, collapseLabel: "收起视图", expandLabel: "展开视图", dragLabel: "拖动 资源管理器"};

    it("multiple 有标题行与动作；收起开关发应有的收起值；收起时内容隐藏不卸载；single 没有标题行", async () => {
        let unmounted = 0;
        const Content = defineComponent({setup: () => {
            onBeforeUnmount(() => {
                unmounted += 1;
            });
            return () => h("p", "内容");
        }});
        const wrapper = mount(WorkbenchViewSection, {props: base, slots: {default: () => h(Content), actions: () => h("button", {"data-action": ""}, "动作")}, attachTo: document.body});
        wrappers.push(wrapper);
        expect(wrapper.attributes("aria-label")).toBe("资源管理器");
        expect(wrapper.find("[data-action]").exists()).toBe(true);
        const toggle = wrapper.get("[data-view-toggle]");
        expect(toggle.attributes("aria-expanded")).toBe("true");
        expect(toggle.attributes("aria-label")).toBe("收起视图");
        await toggle.trigger("click");
        expect(wrapper.emitted("toggle-collapsed")).toEqual([[true]]);

        await wrapper.setProps({collapsed: true});
        expect(wrapper.attributes("data-view-collapsed")).toBe("true");
        expect(wrapper.find("p").isVisible()).toBe(false);
        expect(wrapper.get("[data-view-toggle]").attributes("aria-label")).toBe("展开视图");

        // single：没有标题行，收起不生效（宿主给 false，这里即使给 true 也照样显示内容）。
        await wrapper.setProps({chrome: false});
        expect(wrapper.find("header").exists()).toBe(false);
        expect(wrapper.find("p").isVisible()).toBe(true);
        expect(wrapper.attributes("data-view-collapsed")).toBe("false");
        expect(unmounted).toBe(0);
    });

    it("标题整行点击切换收起；动作区的点击、按下后移动过门槛的（拖动）不切；点展开标记只切一次", async () => {
        const wrapper = mount(WorkbenchViewSection, {props: base, slots: {actions: () => h("button", {"data-action": ""}, "动作")}, attachTo: document.body});
        wrappers.push(wrapper);
        const head = wrapper.get("header");
        await wrapper.get("[data-drag-handle]").trigger("click");
        expect(wrapper.emitted("toggle-collapsed")).toEqual([[true]]);

        await wrapper.get("[data-action]").trigger("click");
        expect(wrapper.emitted("toggle-collapsed")).toHaveLength(1);

        await head.trigger("pointerdown", {clientX: 10, clientY: 10});
        await head.trigger("click", {clientX: 30, clientY: 10});
        expect(wrapper.emitted("toggle-collapsed")).toHaveLength(1);

        await head.trigger("pointerdown", {clientX: 10, clientY: 10});
        await head.trigger("click", {clientX: 13, clientY: 11});
        expect(wrapper.emitted("toggle-collapsed")).toHaveLength(2);

        await wrapper.get("[data-view-toggle]").trigger("click");
        expect(wrapper.emitted("toggle-collapsed")).toHaveLength(3);
    });
});
