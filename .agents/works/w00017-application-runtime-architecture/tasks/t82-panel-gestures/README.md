---
schema: nbook.task/v2
taskId: t82-panel-gestures
status: planned
---

# 底部面板的拖动手势

## 目标与范围

开发者 2026-10-12 手动审查 t79 时提出，选择另开 Task。未开工。

- 拖动面板上沿能一直拖到顶，拖到顶就是最大化（现在高度上限写死 600px：`shell/sizes.ts` 的 `SHELL_PANEL_MAX_HEIGHT`，也没有“拖到顶即最大化”的规则）。
- 点“最大化面板”后，能从顶部往下拖来取消最大化（现在最大化时不画拖动边界）。
- 面板收起时往外拖，拖动过程中内容就显示（现在内容区在收起时 `v-show` 隐藏，“收起”要到松手才改，拖的过程中是一块空面；从代码推断，未在浏览器复现）。

这三条不是 t79 的回归，旧应用同样没有（旧应用面板收起或最大化时也不画拖动边界）。开工时参照 VS Code 的面板手势，先写清阈值与状态转换，再改 [`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳一（面板的四种“消失”）。

## 下一步

开工时读外壳一的面板合同与 `shell/layout.ts`、`shell/panel-state.ts`，写计划交开发者确认。
