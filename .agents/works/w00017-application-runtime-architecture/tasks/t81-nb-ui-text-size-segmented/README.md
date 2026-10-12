---
schema: nbook.task/v2
taskId: t81-nb-ui-text-size-segmented
---

# nb-ui：字号写法被编译成颜色、分段控件截断长选项

## 目标与范围

2026-10-12 t80 搭设置界面静态稿时发现两处 nb-ui 缺陷，开发者要求先建 Task 记下，未开工。

1. **字号写法被编译成颜色**：组件里用 `text-[var(--text-xs)]` 这类写法表示字号，Tailwind v4 把方括号里的 `var(...)` 当成颜色，编译出 `color: var(--text-xs)`，字号没有设上。
   - 实测：`Dropdown` 的紧凑档（`compact`）条目字号变成 16px，颜色无效后落成黑色（t80 子代理在 Lab 里看到，在 `packages/nb-ui/dist/nb-ui.css` 里查到对应规则）。
   - 产物里同类规则四条：`--text-2xs`、`--text-md`、`--text-sm`、`--text-xs`（2026-10-12 时 `dist/nb-ui.css` 第 1596–1618 行）。
   - 源码里 23 个文件、44 处用了这种写法：`controls/` 的 Dropdown、Pagination、SwitchField、Tabs；`display/Spinner`；`feedback/` 的 AlertDialog、Drawer、QuickInput；`form/` 的 Calendar、FormCheckbox、FormField、FormInput、FormNumberInput、FormSelect、MonthPicker、MonthRangePicker、PinInput、RadioGroup、RangeCalendar、YearPicker、YearRangePicker；`layout/Accordion`；`navigation/Breadcrumb`。除 Dropdown 外都是从代码推断，要逐处核对哪些真的丢了字号（有的元素可能另有字号类）。
   - 改法候选：写成带类型提示的 `text-[length:var(--text-xs)]`（或 v4 的 `text-(length:--text-xs)`）；另加一条检查，禁止不带类型提示的 `text-[var(--…)]`，免得再出现。改完重建 `dist/nb-ui.css`，并核对应用自己的 UnoCSS 不会掩盖产物里的问题（`design-language.md` 踩过的坑 27）。
2. **分段控件截断长选项**：`SegmentedControl` 宽度随内容时，各段等分宽度（段上是 `flex-1 min-w-0`），“浅色 / 深色 / 跟随系统”里的“跟随系统”被截成“跟…”。t80 稿子里靠给控件定宽绕开。改法候选：段宽按内容取最宽一段的宽度再等分，或不等分。

不做：别的组件的外观调整。

行为合同未变：修的是组件没按既有设计渲染的缺陷，不改 Spec；`SegmentedControl` 宽度规则若有变化，同步改它的同名 `.md`。

## 前置

t78 正在改 nb-ui（`Tabs`、`Accordion`、`Collapsible`、`IconButton` 与 `styles.css`、`dist/nb-ui.css`），等它提交后开工，避免同一批文件冲突。

## 当前状态

未开工。来源见 [t80 README](../t80-settings-ui/README.md) 的“搭稿时发现的问题”。

## 验收

- 改动的组件在 Lab 里字号与改前设计一致（逐个截图对照）；`Dropdown` 紧凑档条目是 `--text-xs`。
- 新检查对旧写法报错、对带类型提示的写法不报。
- `SegmentedControl` 宽度随内容时三段都完整显示“浅色 / 深色 / 跟随系统”；`fullWidth` 的行为不变。
- `lab-scenes.e2e.ts` 门禁通过。
