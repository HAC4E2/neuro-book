/**
 * `Tabs` 的宽度适配（`overflow="adapt"`，同名 Tabs.md）：标签带放不下时逐级让位——完整标题 → 每个标签截断到
 * `maxItemWidth` → 选中的留标题、其余只显示图标 → 放不下的收进末尾的“更多”。选中的始终在、始终带标题。纯函数，
 * 宽度由组件实测后传入。
 */

/** 0 完整，1 截断，2 只留图标，3 收进“更多”。 */
export type TabsAdaptLevel = 0 | 1 | 2 | 3;

export interface TabsAdaptState {
    readonly level: TabsAdaptLevel;
    /** 收进“更多”的标签（level 3 才有）。 */
    readonly hidden: ReadonlySet<string>;
}

export interface TabsAdaptInput {
    readonly items: ReadonlyArray<{readonly value: string; readonly hasIcon: boolean}>;
    /** 每个标签完整标题时的宽度，与 `items` 同序。 */
    readonly natural: ReadonlyArray<number>;
    /** 只留图标的标签宽度。 */
    readonly iconOnly: number;
    /** “更多”按钮的宽度。 */
    readonly more: number;
    /** 标签之间的间距。 */
    readonly gap: number;
    /** 标签带的可用宽度。 */
    readonly available: number;
    readonly maxItemWidth: number;
    readonly selected: string;
}

/** 展开（变宽一档、少收一个）时要多出来的余量：宽度在临界值附近抖动时不来回切。 */
export const TABS_ADAPT_HYSTERESIS_PX = 16;

const total = (widths: ReadonlyArray<number>, gap: number): number => widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);

function widthsAt(input: TabsAdaptInput, level: 0 | 1 | 2): number[] {
    return input.items.map((item, index) => {
        const natural = input.natural[index] ?? 0;
        if (level === 0) return natural;
        const truncated = Math.min(natural, input.maxItemWidth);
        if (level === 1 || item.value === input.selected || !item.hasIcon) return truncated;
        return Math.min(truncated, input.iconOnly);
    });
}

/** 这个宽度下最宽松的一档。 */
function levelFor(input: TabsAdaptInput, available: number): TabsAdaptLevel {
    for (const level of [0, 1, 2] as const) if (total(widthsAt(input, level), input.gap) <= available) return level;
    return 3;
}

/** 收进“更多”的标签：按只留图标那一档的宽度，先放选中的，再按顺序放其余的，放不下的收起来。 */
function hiddenFor(input: TabsAdaptInput, available: number): Set<string> {
    const widths = widthsAt(input, 2);
    let used = input.more;
    const selectedIndex = input.items.findIndex((item) => item.value === input.selected);
    if (selectedIndex !== -1) used += input.gap + widths[selectedIndex]!;
    const hidden = new Set<string>();
    input.items.forEach((item, index) => {
        if (index === selectedIndex) return;
        const next = used + input.gap + widths[index]!;
        if (hidden.size === 0 && next <= available) used = next;
        else hidden.add(item.value);
    });
    return hidden;
}

/**
 * 下一个状态：要更紧凑时按此刻的宽度收；要放宽时按宽度减去余量判断，余量不够就保持现状。收进“更多”的个数同理。
 * 收起来的总是排在后面的那些（选中的除外），顺序不变。
 */
export function adaptTabs(input: TabsAdaptInput, current: TabsAdaptState): TabsAdaptState {
    const tight = levelFor(input, input.available);
    const loose = levelFor(input, input.available - TABS_ADAPT_HYSTERESIS_PX);
    const level: TabsAdaptLevel = tight > current.level ? tight : loose < current.level ? loose : current.level;
    if (level !== 3) return {level, hidden: new Set()};
    const shrink = hiddenFor(input, input.available);
    if (current.level !== 3 || shrink.size > current.hidden.size) return {level, hidden: shrink};
    const grow = hiddenFor(input, input.available - TABS_ADAPT_HYSTERESIS_PX);
    if (grow.size < current.hidden.size) return {level, hidden: grow};
    // 个数不变：按此刻的选中重新挑（选中的换成了收起来的那个时要把它换出来）
    return {level, hidden: tailHidden(input, current.hidden.size)};
}

/** 收起排在最后的 `count` 个未选中的标签。 */
function tailHidden(input: TabsAdaptInput, count: number): Set<string> {
    const others = input.items.filter((item) => item.value !== input.selected).map((item) => item.value);
    return new Set(others.slice(Math.max(0, others.length - count)));
}
