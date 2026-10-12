---
schema: nbook.task/v2
taskId: t06-cli-core
status: active
---

# 命令行核心：包骨架、写事务、记录读取与领号

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 与 [实施计划的 t06 一节](../t03-design/plan.md#t06-命令行核心包骨架写事务记录读取与领号) 建 `packages/dev-panel` 与命令行 `nbdev` 的核心：定位主工作区、记录读取（含过渡期从执行 worktree 读）、写事务、领号与登记表、`work new`、`task new`、`work status`、`task status`、`registry import`、`status`，一致性测试与规则切换。前提是 [t04](../t04-rule-followups/README.md) 第 2 项（Task 号允许三位），作为本分支的第一个提交一起做。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`（见 [Work README 的“实施”](../../README.md#实施)）。

## 当前状态

- 2026-10-12 开工。t04 第 2 项在集成分支提交 `bc7284ab`。
- [plan.md](plan.md) 写成后交 opus 子代理做设计审查（[报告](evidences/design-review.txt)）：1 阻断、4 重要、8 建议，主 Agent 复现了阻断项（三点 diff 在分支恢复记录后仍报改动）并核实 w00007 是真实的重复分配，13 条全部采纳：
  - “没迁”改为三点与两点 diff 的交集；
  - 提交结果按 HEAD 内容判定；
  - 撞号按 merge-base 继承判定，登记表不作撞号位置；
  - 写操作要求 Work README 已提交；
  - CI 补 code-baseline 与 product-platforms 路径；
  - 其余见计划里的“设计审查的处理”。
- 编码子代理按处理意见改计划并实施 S1 到 S6。

## 下一步

实施完成后主 Agent 审查 diff、自跑验证，再交 opus 子代理做实现审查（不阻塞）。
