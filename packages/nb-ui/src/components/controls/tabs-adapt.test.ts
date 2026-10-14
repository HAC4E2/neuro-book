import {describe, expect, it} from "vitest";

import {adaptTabs, TABS_ADAPT_HYSTERESIS_PX} from "./tabs-adapt";
import type {TabsAdaptInput, TabsAdaptState} from "./tabs-adapt";

/** 三个带图标的标签：完整宽 80、160、70；只留图标 32；“更多” 60；间距 8。 */
const base: Omit<TabsAdaptInput, "available" | "selected"> = {
    items: [{value: "a", hasIcon: true}, {value: "b", hasIcon: true}, {value: "c", hasIcon: true}],
    natural: [80, 160, 70],
    iconOnly: 32,
    more: 60,
    gap: 8,
    maxItemWidth: 96,
};
const START: TabsAdaptState = {level: 0, hidden: new Set()};
const at = (available: number, current: TabsAdaptState = START, selected = "a") => adaptTabs({...base, available, selected}, current);

// 各档的总宽：完整 80+160+70+16=326；截断 80+96+70+16=262；只留图标（选中 a）80+32+32+16=160
describe("Tabs 宽度适配", () => {
    it("放得下就完整；不够依次截断、只留图标、收进“更多”，收的是排在后面的", () => {
        expect(at(326)).toEqual({level: 0, hidden: new Set()});
        expect(at(325).level).toBe(1);
        expect(at(262).level).toBe(1);
        expect(at(261).level).toBe(2);
        expect(at(160).level).toBe(2);
        // 选中 a（80）+ “更多”（60）+ b 的图标（32）+ 两个间距 = 188 放不下：b、c 都收起来
        expect(at(159)).toEqual({level: 3, hidden: new Set(["b", "c"])});
    });

    it("选中的始终在、始终带标题：选中 c 时其余只留图标，再放不下时收起来的是 a、b", () => {
        // 只留图标一档（选中 c）：32 + 32 + 70 + 16 = 150
        expect(at(150, START, "c").level).toBe(2);
        // c（70）+ “更多”（60）+ a 的图标（32）+ 两个间距 = 178，放不下 a
        expect(at(149, START, "c")).toEqual({level: 3, hidden: new Set(["a", "b"])});
    });

    it("变宽时要多出余量才放宽一档；变窄时立即收", () => {
        const truncated = at(300);
        expect(truncated.level).toBe(1);
        expect(at(326, truncated).level).toBe(1);
        expect(at(326 + TABS_ADAPT_HYSTERESIS_PX, truncated).level).toBe(0);
        expect(at(325, {level: 0, hidden: new Set()}).level).toBe(1);
    });

    it("收进“更多”的个数同样有余量；个数不变时选中的换成收起来的那个也会换出来", () => {
        // 四个标签：完整 80、160、70、60。只留图标一档（选中 a）80 + 32×3 + 24 = 200；
        // “更多” 60 + a 80 + 间距 = 148，再放 b 的图标到 188，再放 c 到 228
        const four = {...base, items: [...base.items, {value: "d", hasIcon: true}], natural: [80, 160, 70, 60]};
        const layoutAt = (available: number, current: TabsAdaptState, selected = "a") => adaptTabs({...four, available, selected}, current);
        const three = layoutAt(187, START);
        expect(three).toEqual({level: 3, hidden: new Set(["b", "c", "d"])});
        expect(layoutAt(190, three).hidden).toEqual(new Set(["b", "c", "d"]));
        expect(layoutAt(188 + TABS_ADAPT_HYSTERESIS_PX, three).hidden).toEqual(new Set(["c", "d"]));
        // 选中改成收起来的 d：个数不变，换成 b、c 收起来
        expect(layoutAt(190, {level: 3, hidden: new Set(["c", "d"])}, "d").hidden).toEqual(new Set(["b", "c"]));
    });

    it("没有图标的标签不变成只留图标，按截断宽度算", () => {
        const input = {...base, items: [{value: "a", hasIcon: true}, {value: "b", hasIcon: false}, {value: "c", hasIcon: true}]};
        // 只留图标一档：80 + 96 + 32 + 16 = 224
        expect(adaptTabs({...input, available: 224, selected: "a"}, START).level).toBe(2);
        expect(adaptTabs({...input, available: 223, selected: "a"}, START).level).toBe(3);
    });
});
