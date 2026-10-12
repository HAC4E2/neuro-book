---
schema: nbook.task/v2
taskId: t04-rule-followups
status: planned
---

# 已确认的规则跟进

## 目标与范围

开发者在 t01 补充分析里确认、但 t02 没有改的规则：

1. **worktree 一个 Task 一个**：2026-10-12 已随领域模型第二版的规则改动写进 [Work 规则](../../../README.md#创建与执行) 与 [仓库流程](../../../../../docs/standards/repository-workflow.md#worktree-与分支)。
2. **Task 号允许三位**（t100 起）：改 `scripts/ci/agent-governance-contract.ts` 的 `WORK_TASK_ID_PATTERN` 与 [Work 规则](../../../README.md#目录与身份) 里“两位非零序号”的说法，补治理测试；代码改动在 worktree 里做。
3. **omp 会话目录放 `.local/agent/works/<workId>/tasks/<taskId>/reports/`**：改用户全局规则 `~/.agent/AGENTS.md` 里“会话目录放在仓库之外”那句。

行为合同未变：只改治理规则、治理检查与记录的位置，不改 Spec。

## 当前状态

第 1 项已完成，第 2、3 项未开工。

## 下一步

第 2 项从 `master` 建 worktree 做；第 3 项直接改用户全局规则。
