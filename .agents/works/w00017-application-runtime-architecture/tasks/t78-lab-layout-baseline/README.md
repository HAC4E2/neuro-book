---
schema: nbook.task/v2
taskId: t78-lab-layout-baseline
---

# 清空 Lab 版面基线：贴边控件的聚焦光晕被裁

## 目标与范围

未开工。来源：t77 S4 把 Lab 的版面测量接进 `lab-scenes.e2e.ts` 做门禁（[`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md) 验收 27），第一次全量跑出一批旧问题。开发者 2026-10-12 看过逐个聚焦的截图对照后，选“门禁带基线，另开 Task 清”。基线在 [`e2e/lab-layout-baseline.ts`](../../../../../packages/neuro-book/e2e/lab-layout-baseline.ts)，门禁对多出来和少了的都失败，所以每修好一处要同步改小基线。

目标是把基线清空：

- **聚焦光晕被裁**：控件贴着会裁切的条或面板的边，键盘聚焦时环的实色部分被切成平边。涉及编辑器标签条 `EditorTabBar`、nb-ui `Tabs` 与 `Accordion`，以及工作台的活动栏、条目带、面板外框、外壳布局的视图区、状态栏、视图容器与视图分节。按组件定改法：加内边距（配等量负外边距，见 `ui-development-spec.md` 自检清单的“外扩阴影防裁切”），或者整高的控件改用内嵌焦点环；整高控件的改法先给开发者看。
- **`Collapsible`、`CollapsibleSection` 展开时的 6px**：展开内容用负外边距给焦点环留余量，外框比容器宽 6px，看不出来，只在会横向滚动的父容器里多出 6px 可滚动距离。是改组件还是让测量认这种做法，开工时定。

不做：测量本身的范围与阈值（t77 已定，见 Spec 里 `measure()` 的说明）。

## 证据

- t77 的逐个聚焦对照：[总览](../t77-bookshelf-polish-2/evidences/s4-focus-clip-overview.png)（左：现在；右：把裁切容器改成不裁切）。
- 开门禁时的量值：基线文件本身。

## 下一步

开工时按当时的基线重读范围，写 `plan.md`。
