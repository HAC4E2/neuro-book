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

2026-10-12 开工：编码子代理先做 t04 第 2 项，再写本 Task 的 `plan.md`，交 opus 子代理做设计审查后实施。

## 下一步

`plan.md` 与设计审查。
