---
schema: nbook.task/v2
taskId: t79-workbench-polish
---

# 工作台打磨：打开项目之后的那一页

## 目标与范围

开发者 2026-10-12 问到“打开项目、进入工作台的页面设计做好了没有”。没有：外壳（t65–t74）、资源管理器（t70）、编辑器区（t71）功能齐了，从书架点作品或“继续写作”能进入工作台，但这一页没有像书架那样走过“注意力排序 → 静态稿 → 开发者确认”。t76 当时把“工作台与资源管理器的打磨”列为后续 Task；外壳各片的外观在自主推进期间只留了截图，开发者还没看（[待确认清单](../../pending-confirmations.md) 2026-10-08 第 2 条）。开发者选：设计讨论马上开始、与 t78 实现并行，实现排在 t78 之后。

范围（设计阶段先确认，确认后按结果修订）：

- 打开项目后的第一眼：先看到什么、默认展开或收起什么；
- 没有打开文件时编辑区的空态；
- 从书架到工作台的加载与过渡；
- 标题栏、活动栏、资源管理器、状态栏的外观与信息密度。

不做（设计阶段再核对）：t78 已定的焦点样式与按钮尺寸（随 t78 实现，本 Task 的稿子建立在它之上）。

行为合同：设计确认后定改哪些，候选是 [`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)、[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md)、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)、[`workbench/bookshelf.md`](../../../../../docs/specs/workbench/bookshelf.md)（继续写作的入口）。

## 前置

[t77](../t77-bookshelf-polish-2/README.md) 提交后开始；实现排在 [t78](../t78-lab-layout-baseline/README.md) 之后。

## 当前状态

- 2026-10-12 建立，设计阶段：先和开发者确认注意力排序，再出静态稿。

## 下一步

截现在的工作台（带项目、没打开文件、打开了章节、手机宽度）作讨论的底，问第一个问题：打开项目后的第一眼。
