/** LabNavPanel（同名 .md）：目录的开合写回偏好；搜索时临时全部展开、不写回；选中的组件所在的目录自动展开。 */

import {mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import {labComponents} from "./component-index";
import LabNavPanel from "./LabNavPanel.vue";

/** 受控挂载：像 LabShell 一样把 `update:collapsedGroups` 写回 props，并记下每次写回。 */
function mountPanel(collapsedGroups: string[], selected = "") {
    const updates: string[][] = [];
    const wrapper = mount(LabNavPanel, {
        props: {
            selected, loading: false, collapsed: false, width: 300, collapsedGroups,
            "onUpdate:collapsedGroups": (groups: string[]) => {
                updates.push(groups);
                void wrapper.setProps({collapsedGroups: groups});
            },
        },
        attachTo: document.body,
    });
    return {wrapper, updates};
}

const sample = labComponents.find((entry) => entry.groupPath.length > 0)!;
const topSegment = sample.groupPath[0]!;
const topGroup = `group:${topSegment}`;
const groupRow = (wrapper: VueWrapper) => wrapper.findAll('[role="treeitem"]').find((row) => row.text().trim().startsWith(topSegment))!;

describe("LabNavPanel", () => {
    it("点目录行收起：写回收起的目录；再点展开：从收起集合里去掉", async () => {
        const {wrapper, updates} = mountPanel([]);
        expect(groupRow(wrapper).attributes("aria-expanded")).toBe("true");
        await groupRow(wrapper).trigger("click");
        expect(updates.at(-1)).toEqual([topGroup]);
        await wrapper.vm.$nextTick();
        expect(groupRow(wrapper).attributes("aria-expanded")).toBe("false");
        await groupRow(wrapper).trigger("click");
        expect(updates.at(-1)).toEqual([]);
        wrapper.unmount();
    });

    it("搜索时目录临时全部展开且不写回；清掉检索词回到偏好里的开合", async () => {
        const {wrapper, updates} = mountPanel([topGroup]);
        expect(groupRow(wrapper).attributes("aria-expanded")).toBe("false");
        const search = wrapper.find("input[type=search]");
        await search.setValue(sample.name);
        expect(groupRow(wrapper).attributes("aria-expanded")).toBe("true");
        expect(updates).toEqual([]);
        await search.setValue("");
        expect(groupRow(wrapper).attributes("aria-expanded")).toBe("false");
        wrapper.unmount();
    });

    it("选中收起目录里的组件：目录展开并写回；偏好读到后 revealSelected 也能展开到它", async () => {
        const {wrapper, updates} = mountPanel([topGroup]);
        await wrapper.setProps({selected: sample.name});
        expect(updates.at(-1)).toEqual([]);
        expect(groupRow(wrapper).attributes("aria-expanded")).toBe("true");

        const loaded = mountPanel([], sample.name);
        await loaded.wrapper.setProps({collapsedGroups: [topGroup]});
        expect(loaded.updates).toEqual([]);
        (loaded.wrapper.vm as unknown as {revealSelected(): void}).revealSelected();
        expect(loaded.updates.at(-1)).toEqual([]);
        wrapper.unmount();
        loaded.wrapper.unmount();
    });
});
