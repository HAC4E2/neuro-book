---
schema: nbook.task/v2
taskId: t81-nb-ui-text-size-segmented
status: done
updated: 2026-10-13
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

记录 2026-10-12 按新的 [Work 规则](../../../README.md#记录只放主工作区) 从分支 `t81/nb-ui-fixes` 迁到主工作区，此后只在这里维护。

## 前置

t78 正在改 nb-ui（`Tabs`、`Accordion`、`Collapsible`、`IconButton` 与 `styles.css`、`dist/nb-ui.css`），等它提交后开工，避免同一批文件冲突。

## 当前状态

2026-10-12 完成，在 worktree `.worktree/w00017-t81-nb-ui`（分支 `t81/nb-ui-fixes`，从主线 `d6aa955f` 分出）由编码子代理实施、主 Agent 复跑验证后提交。来源见 [t80 README](../t80-settings-ui/README.md) 的“搭稿时发现的问题”。

- **字号**：23 个文件、44 行改成带类型提示的 `text-[length:var(--text-*)]`（沿用 `Tree.vue` 已有写法；v4 简写 `text-(length:--x)` 应用的 UnoCSS 不认）。实测 UnoCSS 也把旧写法编译成颜色，应用掩盖不了。这些元素改前都没有自己的字号、全靠继承（舞台里 13px，传送到 body 的浮层 16px），颜色也被那条假规则冲掉；改后字号与颜色都回到设计值，sm 档控件（例如 Lab 左栏搜索框、右栏页签）明显变小到 11px，这是按设计渲染，开发者看过对照图后接受。重建后产物里没有 `color: var(--text-*)`。
- **同源的顺手修正**：应用 Lab 夹具里 6 处同样写法；`Tree.vue` 的 `font-[var(--weight-medium)]` 在 UnoCSS 里被编译成 `font-family`，改成两套引擎都对的 `[font-weight:var(--weight-medium)]`。
- **防回归**：nb-ui 的 `token-consumption.test.ts` 加规则 5（字号类带 `length:` 类型提示）与规则 6（字重、字体族用任意属性写），带正反样例，红翻转验证过；只扫 nb-ui 组件，不覆盖应用 `src/`。
- **分段控件**：根节点改为网格，各段等宽，宽度随内容时每段取最宽一段的自然宽度，“跟随系统”不再截断；给定宽度与 `fullWidth` 时各段宽度与改前逐像素相同；指示块在网格里补了 `left` 定位。规则写进 `SegmentedControl.md`，Lab 新增场景 `uneven`。
- **验证**（主 Agent 复跑）：nb-ui `bun run test` 558 通过；应用 `bun run typecheck` 通过、`bun run test:vitest` 165 通过。子代理另跑 `lab-scenes`、`lab-nb-ui`、`lab` e2e 通过，`docs:check`、`governance:check` 无失败。改前改后截图在本机 `.local/agent/works/w00017-application-runtime-architecture/tasks/t81-nb-ui-text-size-segmented/shots/`（`compare/` 是并排对照）。
- **未修、只记**：`[font-weight:var(--weight-semibold,600)]` 引用了没登记的 token（只有 normal、medium、strong），一直落在回退值 600（从产物看到，未回查源码位置）；Dropdown 非紧凑项用 Tailwind 常量 `text-xs`（12px）比紧凑项（11px）还大，分段控件的段用字面量字号，都不走 token。
- **合回**：2026-10-13 开发者同意，先于 t80 合进 `refactor/w00017-runtime-foundation`（合并提交 `efb75a2b5`，随后合 t82、t83）；t83 新抽出的标签盒子类在合并时改用本 Task 的 `text-[length:…]` 写法。合并后 w00017 上 typecheck、受影响单元测试与全套 e2e 189 例都过（见 t83 记录）。t80 的设置窗口目前给分段控件手动定宽绕开截断，t80 合回时可去掉。

## 验收

- 改动的组件在 Lab 里字号与改前设计一致（逐个截图对照）；`Dropdown` 紧凑档条目是 `--text-xs`。
- 新检查对旧写法报错、对带类型提示的写法不报。
- `SegmentedControl` 宽度随内容时三段都完整显示“浅色 / 深色 / 跟随系统”；`fullWidth` 的行为不变。
- `lab-scenes.e2e.ts` 门禁通过。
