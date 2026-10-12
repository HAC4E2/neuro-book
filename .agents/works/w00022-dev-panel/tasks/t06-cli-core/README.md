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
- S1 到 S6 已在集成分支提交：`822a6ee7` 包骨架与登记（根 `workspaces`、`packages/AGENTS.md`、Monorepo 边界、根 `AGENTS.md` 结构图、workspace-packages 矩阵、code-baseline 与 product-platforms 路径）、`5ee9fc5b` 记录读取、过渡期来源与编号扫描、`69c832ba` 锁与写事务、`7f99c5a3` 六个命令与 `install-shim`、`7de49f20` 根一致性测试进 code-baseline、`821e2323` 规则文字（编号经 nbdev 领取等）。实施中的偏差记在 [plan.md](plan.md) 的“实施中的偏差”。
- 主 Agent 复跑（2026-10-12）：
  - 包测试 34 通过（8 个文件，不含 mock）；
  - 包 typecheck（含只带 Node 类型的 `tsconfig.core.json`）通过；
  - 根上一致性、workspace-workflows 与治理测试共 174 通过；
  - `governance:check` 无失败，`docs:check` 0 失败、90 条警告与基线相同；
  - 在真实仓库只读运行 `nbdev status --work w00022`，0.26 秒，状态、两处撞号（w00007 真撞号、w00003 t05 旧副本）与下一个 Work 号 w00023 符合预期。
- 子代理在真实仓库跑过一次 `status` 与 `registry import`（w00017 中 t80、t81 来自 master，其余 81 个来自主线分支；补登 273 个 id，重跑补登 0 个），与独立的手工扫描逐项一致，跑完删掉了建出的登记表与 `run/`。
- 未验证的边界：
  - 别的会话恰好在 `diff --cached` 与 `commit` 之间提交的真实时序，只在构造的 Git 状态上测了判定；
  - 两个持锁者的竞态没有真正触发；
  - 会话身份 `by` 等 t07。

## 下一步

opus 子代理做实现审查（不阻塞），同时开始 t07；写 `~/.local/bin/nbdev`、真实仓库第一次用 nbdev 建 Work、合入 `master` 等开发者授权。
