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

- 2026-10-12 开工，[plan.md](plan.md) 写成后交 opus 子代理做设计审查（[报告](evidences/design-review.txt)）：0 阻断、7 重要、13 建议。20 条全部采纳，其中：
  - 答复与确认的 id 在锁内单调生成，“未确认”按集合差算；
  - close 撤回未答的题，重新打开时恢复；
  - 答复按最新一版的题校验；
  - 发布与答复不改 README 的 `updated`；
  - 写入要求 Task 来自 master；
  - 提问标记前缀改为 `data-nbdev-*`；
  - “空闲会话被 `--wait` 唤醒”由主 Agent 在主会话里验证。
- 编码子代理按处理意见改计划并实施 S1 到 S5。

## 下一步

实施完成后主 Agent 复跑验证、做唤醒验证，再交 opus 子代理做实现审查（不阻塞）。
