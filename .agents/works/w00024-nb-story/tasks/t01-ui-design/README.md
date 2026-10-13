---
schema: nbook.task/v2
taskId: t01-ui-design
status: active
updated: 2026-10-13
---

# nb-story 第一版界面设计

## 目标与范围

定下 nb-story 第一版网页（查看器加问答）的版式、入口和信息层级，按 [design-review](../../../../../.claude/skills/design-review/SKILL.md) 的流程：先定注意力排序，再在 Lab 里用真实 nb-ui 组件搭静态稿逐轮评审，定稿后把行为写进 `planned` Spec。

- 不写产品代码。Lab 草稿放在单独的草稿 worktree，等 w00017 合入 master 后再开（开发者 2026-10-13 定：先等 w00017 合入）。
- 设计依据：w00005 的提案 `docs/proposals/novel-story-app.md`（accepted，2026-10-13；随 w00005 落到 master 之前，只在 `.worktree/w00005-novel-understanding-spike/` 里）。
- 数据：w00005 t34 自动抽取的前 100 章。

合同：定稿后写 `planned` Spec（查看器、问答）；本 Task 不改现有 Spec。

## 当前状态

- 现状与参照清单：[reference.md](reference.md)（数据、t28 查看器的问题、要沿用的机制和它防什么、外部参照）。
- 第 1 轮评审板 [artifacts/review/index.html](artifacts/review/index.html)：只问注意力排序，五道题（首页、默认收起、问答的位置、嵌进 NeuroBook 后的尺寸、t28 机制沿用哪些），每题附推荐。已用 nbdev 发布，等开发者答复。

## 决定

（等第 1 轮答复）

## 下一步

1. 读第 1 轮答复，把决定按题号写进上一节，`nbdev answers ack` 与本文件一起提交。
2. w00017 合入后开草稿 worktree，按定下的排序在 Lab 里搭第 2 轮静态稿（首页、人物卡、秘密矩阵、问答页）。
