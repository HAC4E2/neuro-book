---
schema: nbook.task/v2
taskId: t04-rule-followups
status: done
updated: 2026-10-13
---

# 已确认的规则跟进

## 目标与范围

开发者在 t01 补充分析里确认、但 t02 没有改的规则：

1. **worktree 一个 Task 一个**：2026-10-12 已随领域模型第二版的规则改动写进 [Work 规则](../../../README.md#创建与执行) 与 [仓库流程](../../../../../docs/standards/repository-workflow.md#worktree-与分支)。
2. **Task 号允许三位**（t100 起）：改 `scripts/ci/agent-governance-contract.ts` 的 `WORK_TASK_ID_PATTERN` 与 [Work 规则](../../../README.md#目录与身份) 里“两位非零序号”的说法，补治理测试；代码改动在 worktree 里做。
3. **omp 会话目录放 `.local/agent/works/<workId>/tasks/<taskId>/reports/`**：改用户全局规则 `~/.agent/AGENTS.md` 里“会话目录放在仓库之外”那句。

行为合同未变：只改治理规则、治理检查与记录的位置，不改 Spec。

## 当前状态

- 第 1 项已完成（2026-10-12）；`.agents/works/AGENTS.md` 第 3 条随后也改成一个 Task 一个 worktree。
- 第 3 项已完成（2026-10-12）：用户全局规则改为会话目录放在不进 Git 的位置，项目规定了本地目录的放那里（本仓库是 `.local/agent/works/<workId>/tasks/<taskId>/reports/`），否则放仓库之外；审查报告与会话目录放在一起。
- 第 2 项已完成（2026-10-12）：集成分支 `feat/w00022-dev-panel` 的第一个提交 `bc7284ab`，`WORK_TASK_ID_PATTERN` 允许 t01–t99 与 t100 起的三位（拒绝 t00、t000、t050 等带前导零的写法），Work 规则同步改写，治理测试补正反例；主 Agent 复跑治理测试 159 通过、`governance:check` 无失败。随集成分支合入 `master` 后生效，在此之前 `master` 上仍只认两位。
- 2026-10-13 开发者授权后，集成分支 `16cfb817e` 本地合入 `master`（合并提交 `7e837bd80`，没有 PR、没有 push master）；合并提交上复跑包测试 173 个、typecheck、`build:web`、根上三个测试文件 175 个、`governance:check`、`docs:check` 都通过。

## 下一步

无。已合入 `master`，标为 `done`。
