---
schema: nbook.task/v2
taskId: t08-artifacts-answers
status: active
updated: 2026-10-12
---

# 产物、提问与答复（命令行）

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第三节与 [实施计划的 t08 一节](../t03-design/plan.md#t08-产物提问与答复命令行)：发布记录与提问标记解析、挂在 Task 上的提问（没有页面的产物）、提问的四种结局、答复与确认的格式、状态现算、图片体积检查、文档类产物索引；命令 `artifact publish`、`artifact close`、`ask`、`answers`（含 `--wait`、`ack`、`record`）；`status` 输出收件箱；design-review 改用 `nbdev artifact publish`。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。测试只在临时仓库里发布，不在真实仓库发布（真实仓库第一次使用 nbdev 要开发者授权）。

## 当前状态

2026-10-12 开工：编码子代理写 `plan.md`，交 opus 子代理做设计审查后实施。

## 下一步

`plan.md` 与设计审查。
