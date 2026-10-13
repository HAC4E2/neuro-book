---
schema: nbook.task/v2
taskId: t78-lab-layout-baseline
---

# 清空 Lab 版面基线：贴边控件的聚焦光晕被裁

## 目标与范围

计划已确认，见 [plan.md](plan.md)。来源：t77 S4 把 Lab 的版面测量接进 `lab-scenes.e2e.ts` 做门禁（[`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md) 验收 27），第一次全量跑出一批旧问题。开发者 2026-10-12 看过逐个聚焦的截图对照后，选“门禁带基线，另开 Task 清”。基线在 [`e2e/lab-layout-baseline.ts`](../../../../../packages/neuro-book/e2e/lab-layout-baseline.ts)，门禁对多出来和少了的都失败，所以每修好一处要同步改小基线。

目标是把基线清空：

- **聚焦光晕被裁**：控件贴着会裁切的条或面板的边，键盘聚焦时环的实色部分被切成平边。涉及编辑器标签条 `EditorTabBar`、nb-ui `Tabs` 与 `Accordion`，以及工作台的活动栏、条目带、面板外框、外壳布局的视图区、状态栏、视图容器与视图分节。按组件定改法：加内边距（配等量负外边距，见 `ui-development-spec.md` 自检清单的“外扩阴影防裁切”），或者整高的控件改用内嵌焦点环；整高控件的改法先给开发者看。
- **`Collapsible`、`CollapsibleSection` 展开时的 6px**：展开内容用负外边距给焦点环留余量，外框比容器宽 6px，看不出来，只在会横向滚动的父容器里多出 6px 可滚动距离。是改组件还是让测量认这种做法，开工时定。

不做：测量本身的范围与阈值（t77 已定，见 Spec 里 `measure()` 的说明）。

## 证据

- t77 的逐个聚焦对照：[总览](../t77-bookshelf-polish-2/evidences/s4-focus-clip-overview.png)（左：现在；右：把裁切容器改成不裁切）。
- 开门禁时的量值：基线文件本身。

## 当前状态

- 2026-10-12 设计与计划：
  - 逐个场景量过裁切它的祖先与四边余量，归成几类：填满所在条的控件（标签条、状态栏与条目带、折叠面板标题行），离边 2–3px 的头部图标按钮，贴顶的活动栏，被省略号裁切切掉的标题把手，`Collapsible` 的 6px。
  - 在真实 Chrome 的 Lab 里键盘聚焦、注入候选样式做对照，没改源码：[内嵌焦点对照](evidences/draft-inset-ring.png)（现状、内嵌柔光、内嵌细线；nbook 明暗与 macos 浅色）、[让位对照](evidences/draft-room.png)（活动栏、面板头、视图分节头、标题把手）。
  - 开发者选：内嵌细线（柔光版深色下几乎看不见）；活动栏改 38px 加留白；头部图标按钮新增 24px 档、头部 32px 不变；`Collapsible` 改组件，只在动画期间裁切。计划经开发者确认。

- 2026-10-12 S1（nb-ui）完成：
  - `styles.css` 新增 `.nb-ui-focus-ring-inset`（`inset 0 0 0 1.5px var(--focus-outline)`）；`Button`、`IconButton` 加 `focusRing`（`outer` 缺省、`inset`），选类在 `controls/focus-ring.ts`；`IconButton` 新增 `xs`（24px）。
  - `Tabs` 的标签、`Accordion` 的标题行改用内嵌焦点线。
  - 折叠内容（`Collapsible`、`Accordion`）去掉常驻裁切与“内边距加负外边距”，只在高度动画进行中打 `data-animating` 并裁切（`layout/collapse-animation.ts`，`.self` 过滤子元素冒上来的动画事件）。
  - Lab：焦点规则只画内阴影的不算会被裁的环（`lab-debug.ts` 的 `drawsRing`），Spec `ui/component-lab.md` 改 `measure()` 说明、追加验收 29，`lab-shot.e2e.ts` 新增用例。
  - 文档：组件 `.md`（`Tabs`、`Accordion`、`Button`、`IconButton`、`Collapsible`）、`ui-development-spec.md`（焦点准则与自检清单）、`design-language.md` 坑 48 的修法。
  - 基线删去 `Tabs` 三个场景、`Accordion` 两个、`Collapsible`、`CollapsibleSection`，以及外壳布局两个场景里的“光晕被裁 Tabs”，剩 29 个场景。
  - 验证：nb-ui 553 例、两包 typecheck；`lab-scenes`、`lab-shot` 7 例全过；变异 6 处全部被抓到（`IconButton` 不理会 `focusRing`、动画标记不分开始结束、`Tabs` 与 `Accordion` 改回外扩光晕、Lab 把内阴影当环、折叠内容恢复负外边距）；`lab:shot` 六个组件 × nbook、macos × 明暗 × 手机与宽画布全部 0 问题；[键盘聚焦实拍](evidences/s1-inset-focus.png)。

- 2026-10-12 S2（工作台、编辑器与 Lab 夹具）完成，基线清空：
  - 内嵌焦点线：编辑器标签与标签的关闭按钮，状态栏与条目带的按钮（`focus-ring="inset"`）。关闭按钮在 macos 主题下离标签条的边只有 2.8px（门禁只量默认主题，是 `lab:shot` 的 macos 截图报出来的）。
  - 让位：活动栏改 `IconButton` 的 `lg`（38px），删去写死的 40px，滚动区上下留 4px；面板头、视图分节头与“移动到”菜单的图标按钮改 `xs`（24px）；视图分节头左右、横向收起竖条上下、工具区头部与面板头右侧、面板导航带末尾各留 4px。
  - 视图分节标题与工具区容器标题的省略号裁切挪到拖动把手自己身上，标题不再裁切。
  - Lab 夹具：外壳场景里面板标题行的“面板”按钮与夹具状态栏按钮用内嵌焦点线；视图分节夹具的示例动作按钮改 24px；样例视图压紧上边距与间距（视图只有 58px 高时输入框贴着底边）。
  - `e2e/lab-layout-baseline.ts` 改为空表，保留比对机制与说明。
  - 组件文档：`EditorTabBar`、`WorkbenchStatusBar`、`WorkbenchItemStrip`、`WorkbenchActivityBar`、`WorkbenchPanelSurface`、`WorkbenchViewSection`、`WorkbenchToolPartHost`、`WorkbenchMoveViewMenu`。
  - 验证：
    - `lab-scenes` 门禁在空基线下连跑三轮都通过（中间一轮在关闭按钮改动之后）；全量 e2e 163 例全过；neuro-book vitest 165 例、typecheck 为 0；
    - 变异 7 处全部被门禁抓到（编辑器标签改回外扩、状态栏面板按钮去掉内嵌、活动栏滚动区不留白、视图分节头内边距改回 2px、标题重新裁切、面板导航带不留右边距、工具区头部右边距改回 2px）；
    - `lab:shot` 九个组件 × nbook、macos × 明暗 × 手机与宽画布全部 0 问题（`WorkbenchViewContainerHost` 要指定场景，不指定时 Lab 等不到就绪，是 `lab:shot` 原有的问题；`WorkbenchToolPartHost` 没有自己的场景，验证入口是 `WorkbenchShellLayout`）；[键盘聚焦实拍](evidences/s2-focus.png)。
  - 未覆盖：门禁只在默认主题（nbook）下量；macos 下的问题靠 `lab:shot` 截图发现，本次改动的组件已在 macos 下截过。

- 2026-10-12 omp 实现审查 5 条全部属实，处理完（[审查与处理](evidences/implementation-review.md)）：Lab 门禁的焦点环判断补上“内阴影混 `var()` 外阴影”（C5）与 outline 简写用 `var()`（C1，base 上已有）；横向收起竖条里的长标题伸出竖条、没有省略号（C2，Lab 实测属实）已修；折叠动画与内嵌焦点线补真实浏览器用例（C3、C4）。变异 7 处全部被抓到。Task 完成。

## 下一步

无。
