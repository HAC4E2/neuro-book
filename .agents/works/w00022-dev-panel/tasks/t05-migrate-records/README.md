---
schema: nbook.task/v2
taskId: t05-migrate-records
status: planned
---

# 把记录迁到主工作区

## 目标与范围

2026-10-12 起 Work 与 Task 的记录只放主工作区 `master` 的 `.agents/works/`（[Work 规则](../../../README.md#记录只放主工作区)，决定见 [领域模型第八节](../t03-design/domain-model.md#八开发者的决定2026-10-12)）。本 Task 把之前在实现分支上维护的记录迁过来，并让这些分支以后合入时不再带 `.agents/works/` 的改动。

2026-10-12 的现状（各分支相对 `master` 改了 `.agents/works/` 下多少个文件）：

| 分支 | worktree | 文件数 |
|---|---|---|
| `feat/w00005-v6-ingest-viewer` | `.worktree/w00005-novel-understanding-spike` | 5005 |
| `refactor/w00017-runtime-foundation` | `.worktree/w00017-runtime-foundation` | 748 |
| `t80/settings-ui` | `.worktree/w00017-t80-settings-ui` | 735 |
| `t81/nb-ui-fixes` | `.worktree/w00017-t81-nb-ui` | 734 |
| `t80/drafts` | `.worktree/w00017-t80-drafts` | 727 |
| `feat/w00002-harness-kernel` | `.worktree/w00002-neuro-agent-harness-redesign` | 678 |
| `feat/w00021-smart-ime-spike` | `.worktree/w00021-smart-ime-spike` | 83 |

每条分支要做的：

1. 把分支上较新的 Work 与 Task 记录合到主工作区，同一份记录在几条分支上都有改动时（例如 w00017 的长期分支与 t80、t81 分支）先比对再合；按“本地与入库”判断，属于原始输出的（例如 w00005 的运行日志）不迁，移到 `.local/agent/`。
2. 在分支上把 `.agents/works/` 恢复成 `master` 的版本并提交，以后合入不再改记录。
3. 补 `status` 字段与 Work 的“目标”一节。

另把 `.local/agent/works/` 里属于产物的东西搬进对应 Task 的 `artifacts/`：t80 的评审板（`r1/`–`r4/` 的 PNG 按体积上限转 WebP）、t80 的 omp 审查报告正文、w00017 Work 级的平台评审页；t03 评审板里指向 t80 材料的相对路径随之改到新位置。

行为合同未变：只改治理规则、治理检查与记录的位置，不改 Spec。

## 限制

- 这些分支多数由别的会话在用（例如 k1-kernel-multi-instance-runtime 在用 `.worktree/w00017-runtime-foundation`）。动某条分支之前先和它的会话或开发者协调；未协调的分支不动。
- 已入库的历史不改写；分支上的恢复用新提交完成，不 force push。

## 当前状态

未开工。

## 下一步

先列出每条分支的记录差异与归属会话，交开发者定迁移顺序与授权。
