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

第 1 轮（评审板 v1，开发者 2026-10-13 在面板上答复，答复 `20261013T140832371Z-8153e139`）：

1. **首页（`home`）**：打开一本书回到上一次的界面（页面、人物、阅读位置）；第一次打开时进入全书总览（主要人物、秘密矩阵、未解悬念数、数值余额）。没有采用推荐的“本章”。
2. **默认收起（`default-collapsed`）**：次要人物、记录编号、原文里夹着的段落块概括、琐碎的悬念、人物卡里的长称呼表默认收起；标了“推断”的记录照常显示。
3. **问答的位置（`qa-place`）**：顶栏常驻提问框，回车后进问答页。
4. **嵌进 NeuroBook 后的尺寸（`embed-size`）**：两种都要。整页是主体；侧栏精简版以后再做；第一版保证整页在窄宽度下不坏。
5. **沿用 t28 的机制（`keep-mechanisms`）**：读到哪里、段落记录条数和点段看记录、名字带底色可点、“明说、推断、角色的说法”标签、“没有记录不等于不知道”的图例，以及“说明与统计”页，六项都沿用。没有采用“去掉统计页”的推荐。
6. **布局（答复备注）**：布局像 IDE，各面板之间要能拖拽改变尺寸，也要能收起；这部分参考 nb-ui 或 NeuroBook 工作台的 grid 代码，看能否复用。

## 下一步

1. 调研可复用的面板布局代码（nb-ui、工作台 grid、`docs/specs/ui/nested-grid.md`），结论写进本 Task。
2. w00017 合入后开草稿 worktree，按定下的排序在 Lab 里搭第 2 轮静态稿（全书总览、人物卡、秘密矩阵、问答页，带可拖拽、可收起的面板）。
