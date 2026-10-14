# t78 实施计划：清空 Lab 版面基线

## Context

- **为什么做**：t77 把 Lab 的版面测量接进 `lab-scenes.e2e.ts` 做门禁（[`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md) 验收 27），第一次全量跑出 36 个场景的旧问题，记在 [`e2e/lab-layout-baseline.ts`](../../../../../packages/neuro-book/e2e/lab-layout-baseline.ts)。基线里的场景等于给门禁开了口子：同一场景再出同类问题门禁看不出。目标是把基线清空。
- **问题的形状**（2026-10-12 逐个场景量过，键盘聚焦截图对照见 [t77 总览](../t77-bookshelf-polish-2/evidences/s4-focus-clip-overview.png)）：
  - 填满所在条的控件：横向滚动的标签条（nb-ui `Tabs`、编辑器标签）把纵向也裁掉，标签贴着条的上边与左边；状态栏与条目带是 20px 的按钮放在 20–22px 高、`overflow: hidden` 的条里；`Accordion` 标题行整行贴着圆角卡片的边。这些控件四周没有余地，外扩光晕怎么调都会被切。
  - 其余按钮：活动栏 40px 按钮在 46px 宽的滚动列里、上边贴边；面板头、视图分节头、工具区头里 26px 的图标按钮离卡片边 2–3px，光晕实色部分要 3.5px。
  - 视图分节标题的拖动把手被标题的省略号裁切切掉上下。
  - `Collapsible`、`CollapsibleSection` 展开时内容用 `padding: 6px; margin: -6px` 给里面的焦点环留余量，外框宽出 6px。
  - Lab 样例视图里的输入框贴着视图边（夹具内容，不是产品）。
- **开发者已确认**（2026-10-12，看过 [内嵌焦点对照](evidences/draft-inset-ring.png) 与 [让位对照](evidences/draft-room.png)）：
  - 填满所在条的控件用**内嵌细线**：1.5px，焦点描边色（`--focus-outline`）；柔光版在深色下几乎看不见，不用。
  - 活动栏改用 `IconButton` 现成的 38px 档（`lg`），滚动区上下各留 4px，保持外扩光晕。
  - 头部图标按钮：`IconButton` 新增 24px 档给面板头、视图分节头、工具区头用，头部 32px 不变；视图分节头左右内边距 2px 改 4px。
  - `Collapsible` 改组件：展开完成后不裁切，只在动画期间裁切，去掉内边距加负外边距。
- **工作方式**：在 worktree `.worktree/w00017-runtime-foundation`，t77 提交之后开始。测量的范围与阈值不动（t77 已定）。

## 关键设计

### 1. 内嵌焦点线（`packages/nb-ui/src/styles.css`、`controls/`、`layout/`）

- `styles.css` 在 `.nb-ui-focus-ring` 旁新增 `.nb-ui-focus-ring-inset:focus-visible`：`outline: none; box-shadow: inset 0 0 0 1.5px var(--focus-outline)`，过渡与外扩版相同。不新增主题 token：描边色已是主题装饰 token（`theme/tokens.ts` 的 `nbThemeDecorTokens`）。
- 规则：控件填满所在条的高或整行的宽、四周没有留白时用内嵌；其余控件用外扩光晕，四周至少留 3.5px（光晕实色部分）。
- `Tabs.vue` 的触发器、`Accordion.vue` 的标题行改用内嵌类（两者在任何上下文都是填满条的形态）。
- `Button.vue`、`IconButton.vue` 增加 `focusRing?: "outer" | "inset"`（缺省 `outer`），按它选两个类之一；不靠调用方叠加类名，免得两条规则靠样式表顺序决定胜负。

### 2. 尺寸档（`packages/nb-ui/src/components/controls/IconButton.vue`）

- `IconButtonSize` 增加 `xs`：24px 见方、圆角 6px、图标字号与 `sm` 相同。
- 用法写进 `IconButton.md`：一行 32px 的头部里的图标按钮用 `xs`，四周各留 4px。

### 3. 折叠内容（`packages/nb-ui/src/styles.css`、`layout/Collapsible.vue`、`layout/Accordion.vue`）

- 去掉 `.nb-collapsible-content`、`.nb-accordion-content` 的 `padding: 6px; margin: -6px`，以及 `Collapsible.vue` 内容上常驻的 `overflow-hidden`。
- 只在高度动画进行中裁切：内容在 `animationstart` 时打标记、`animationend` 与 `animationcancel` 时去掉，样式表按标记加 `overflow: hidden`。展开后不裁切，里面的焦点环有正常的空间；动画期间被裁的那 200ms 没有人在操作里面的控件。
- `design-language.md` 坑 48 的“修法”改成这个做法，并写明为什么不再用负外边距（外框宽出、在可横向滚动的父容器里多出滚动距离）。

### 4. 工作台与编辑器（`packages/neuro-book/src/plugins/workbench/web/components/`、`plugins/editor/web/components/`）

- `EditorTabBar.vue` 的标签按钮改用内嵌类。
- `WorkbenchStatusBar.vue`、`WorkbenchItemStrip.vue` 渲染的条目按钮传 `focus-ring="inset"`。
- `WorkbenchActivityBar.vue`：条目改用 `IconButton size="lg"`，删去写死 40px 的样式与注释；滚动区 `padding-block: 4px`（底部区同样处理，保持上下对称）。
- `WorkbenchPanelSurface.vue`、`WorkbenchViewSection.vue`、`WorkbenchToolPartHost.vue` 头部的图标按钮改 `size="xs"`；`WorkbenchViewSection` 头部 `padding-inline` 改 `var(--space-2)`。
- `WorkbenchViewSection.vue` 标题：省略号裁切从 `h3` 挪到拖动把手自己身上（把手 `display: inline-block; max-width: 100%`），`h3` 不再裁切。
- `WorkbenchShellLayout/collapsed` 场景里那个 26px 的“面板”按钮：开工时先核实是不是夹具内容；是夹具只改夹具，是产品按头部图标按钮同样处理。

### 5. Lab（`packages/neuro-book/src/plugins/lab/web/fixtures/`、`e2e/`）

- 样例视图 `shell-scene/SampleView.vue` 的输入框四周留边。
- `lab-layout-baseline.ts` 随每片修复同步删条目，清空后保留文件与比较机制（Spec 验收 27 写的是“和基线比”），记录改为空表与一句说明。

## Spec 与文档改动

| 文档 | 改什么 |
|---|---|
| `packages/nb-ui/docs/ui-development-spec.md` | 焦点环小节加“填满所在条的控件用内嵌焦点线”；自检清单“外扩阴影防裁切”一条按实色部分 3.5px 与内嵌规则改写 |
| `packages/nb-ui/docs/design-language.md` | 坑 48 的修法；焦点状态的描述补内嵌形态 |
| nb-ui 同名 `.md` | `Tabs.md`、`Accordion.md`、`Button.md`、`IconButton.md`（`focusRing`、`xs`）、`Collapsible.md`、`CollapsibleSection.md` |
| 工作台与编辑器同名 `.md` | `EditorTabBar.md`、`WorkbenchStatusBar.md`、`WorkbenchItemStrip.md`、`WorkbenchActivityBar.md`、`WorkbenchPanelSurface.md`、`WorkbenchViewSection.md`、`WorkbenchToolPartHost.md` |
| `docs/specs/ui/component-lab.md` | 不改行为；基线清空后核对验收 27 的措辞仍成立 |

行为 Spec（`ui/workbench-shell.md`）只定了 32px 标题头，按钮尺寸不在合同里，不改。

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S1 | 1、2、3 | nb-ui：内嵌类、`focusRing`、`IconButton xs`、折叠内容；`Tabs`、`Accordion` 改用内嵌；文档；`build:css` 与 `dist/nb-ui.css`；基线删去 `Tabs`、`Accordion`、`Collapsible`、`CollapsibleSection` 条目 | `bun run --cwd packages/nb-ui test`、typecheck；`lab-scenes.e2e.ts` |
| S2 | 4、5 | 工作台、编辑器与 Lab 夹具；基线清空；文档 | neuro-book typecheck 与相关 DOM 测试；`lab-scenes.e2e.ts`；改动组件的 `lab:shot` |
| S3 | — | 全量 e2e、截图证据、Task 记录；omp 实现审查（Task 收尾、不阻塞） | 全量 e2e、`test:affected --typecheck`、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 由谁覆盖 |
|---|---|
| 全部场景在手机画布上没有聚焦光晕被裁、越界与横向溢出，基线为空 | `lab-scenes.e2e.ts`（门禁对多与少都失败） |
| 标签、编辑器标签、状态栏条目、折叠面板标题行聚焦时是内嵌细线，其余按钮保持外扩光晕 | `lab:shot` 截图（nbook、macos × 明暗 × 1280 与 390），键盘聚焦对照图 |
| `focusRing` 选类、`IconButton xs` 尺寸 | nb-ui 组件测试 |
| 折叠内容动画中裁切、展开后不裁切，没有负外边距 | nb-ui 组件测试读标记与样式；门禁的 `Collapsible`、`CollapsibleSection` 场景 |
| 变异：任一处退回（标签改回外扩、活动栏改回 40px、头部按钮改回 26px、把手裁切放回 `h3`、折叠内容常驻裁切） | `lab:shot` 对该组件报出被裁或越界 |

## 验证

- 门禁：`lab-scenes.e2e.ts` 连跑两轮结果一致、基线为空。
- 真实浏览器观察：开发会话里用键盘在书架、工作台（活动栏、侧栏分节头、面板头、标签、状态栏）之间走一遍焦点，截图存 `evidences/`。
- 未验证的边界：WebKit（桌面版 Tauri 的 macOS 内核）只在 Chrome 量过；内嵌焦点线与动画标记都不依赖 Chrome 专有特性。

## 不做与风险

- 不做：测量的范围与阈值；产品其它地方不在基线里的焦点样式统一。
- 风险：`Tabs` 与 `Accordion` 改用内嵌会影响所有使用者（书架之外的设置页等），在 `lab:shot` 截图里逐个看；活动栏按钮从 40px 变 38px，选中底色随之变小，截图里核对。
