---
schema: nbook.task/v2
taskId: t78-lab-layout-baseline
---

# 清空 Lab 版面基线：贴边控件的聚焦光晕被裁

## 目标与范围

计划已确认，见 [plan.md](plan.md)；t77 提交后开工。来源：t77 S4 把 Lab 的版面测量接进 `lab-scenes.e2e.ts` 做门禁（[`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md) 验收 27），第一次全量跑出一批旧问题。开发者 2026-10-12 看过逐个聚焦的截图对照后，选“门禁带基线，另开 Task 清”。基线在 [`e2e/lab-layout-baseline.ts`](../../../../../packages/neuro-book/e2e/lab-layout-baseline.ts)，门禁对多出来和少了的都失败，所以每修好一处要同步改小基线。

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

## 下一步

t77 提交后从 S1（nb-ui）开始。
