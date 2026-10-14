---
标签: []
别名: ["设置页内列表", "Settings Page List"]
---

# SettingsPageList

设置窗口里 `fill` 页面的二级列表（[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md) 输出 19）：页面自己分栏时，左边一列条目（例如模型服务页的服务商），选一项、右边显示它的详情。设置窗口自己已经有一列分区导航，两列挨在一起时容易读成同一张表，所以它的选中样式与分区导航不同：分区导航的选中项是中性灰底，这里是强调色的文字、细描边与很淡的强调色底。

## 布局

竖排的条目，占满父级宽度；每条一行：可选图标、标题（单行，放不下以省略号结尾），可选的第二行说明，右端可选一块附加内容（徽标、状态）。列表自己不滚动，条目多时由页面给的容器滚动。条目之间 `--space-1` 的间距，四周留出焦点环的余量。窄屏结构不变。

## 交互

- 点一条即选中，发 `update:modelValue`；已选中的再点不发。
- 列表是一个 Tab 停靠点（选中项，没有选中时第一项）：上下键移到上一条、下一条并选中，Home、End 到首尾；不循环。
- 停用的条目不能点、键盘跳过，以 `title` 写原因（`disabledReason`）。
- 读屏：`role="listbox"`，条目 `role="option"` 带 `aria-selected`；列表的可访问名称取 `label`。

## 数据

```ts
interface SettingsPageListItem {
    readonly id: string;
    readonly title: string;
    /** 第二行的说明。 */
    readonly description?: string;
    /** 图标类名，例如 i-lucide-server。 */
    readonly icon?: string;
    /** 给了就停用这一条，文字作提示。 */
    readonly disabledReason?: string;
}

type Props = {
    /** 条目；必填。 */
    items: ReadonlyArray<SettingsPageListItem>;
    /** 选中的条目 id；受控，没有选中为 null。 */
    modelValue: string | null;
    /** 列表的可访问名称；必填。 */
    label: string;
};

type Emits = {
    (event: "update:modelValue", id: string): void;
};

type Slots = {
    /** 条目右端的附加内容。 */
    end?(props: {item: SettingsPageListItem; selected: boolean}): unknown;
};
```

没有 expose；attrs 落在根（`role="listbox"` 的元素）上。条目带 `data-settings-page-list-item`（id）。

## 状态

- 选中：强调色文字、细描边与淡强调色底；悬停是中性的淡底。
- 停用：降低不透明度，不响应指针与键盘。
- 空：`items` 为空时不画任何条目，空态由页面自己写。

## 不支持

- 多选、拖动排序、分组小标题。
- 自己滚动或虚拟化。
