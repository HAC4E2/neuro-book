---
schema: nbook.task/v2
taskId: t07-session-leases
status: active
updated: 2026-10-12
---

# 会话身份、运行归属与租约

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第四节与 [实施计划的 t07 一节](../t03-design/plan.md#t07-会话身份运行归属与租约)：`nbdev` 认出调用它的会话（Claude 会话、子代理、herdr 里的 Agent、会话派出的进程、`--as` 外部会话），Task 相关操作顺手取得或续期租约，失效按 herdr 会话列表与 24 小时计算；`lease take`、`lease list`、`release`；Task 改成 `done` 或 `shelved` 时自动释放；herdr pane 标签；运行的发现与归属；`status` 输出“谁在动”与各会话的运行。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。L4 测试在本机 herdr 里另建命名会话 `nbdev-test`，用完删除，不碰默认会话。

## 当前状态

2026-10-12 开工：编码子代理写 `plan.md`，交 opus 子代理做设计审查后实施。

## 下一步

`plan.md` 与设计审查。
