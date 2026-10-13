---
schema: nbook.task/v2
taskId: t82-panel-gestures
status: active
---

# 底部面板的拖动手势

## 目标与范围

开发者 2026-10-12 手动审查 t79 时提出，选择另开 Task：

- 拖动面板上沿能一直拖到顶，拖到顶就是最大化。
- 点“最大化面板”后，能从顶部往下拖来取消最大化。
- 面板拖到零以后往外拖，拖动过程中内容就显示。

这三条不是 t79 的回归，旧应用同样没有。行为合同改 [`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳一的输出 4、7、8。

## 当前状态

- 2026-10-13 读完代码，原因与做法写在 [plan.md](plan.md)：把“拖到顶即最大化”做成编辑器在面板那一轴上拖到零，复用现有的收起判定；拖动中按网格的预览把内容搬出停放区。
- 2026-10-13 开发者确认 plan.md 的三项都按推荐（去掉面板高与宽的固定上限、能最大化的位置都适用、阈值 24px）。

## 下一步

建 worktree `.worktree/w00017-t82-panel-gestures`（分支 `feat/w00017-t82-panel-gestures`，从 `refactor/w00017-runtime-foundation` 切出），开始 S1。
