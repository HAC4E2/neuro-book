---
schema: nbook.task/v2
taskId: t02-local-vs-repo-rules
---

# 本地与入库的规则

## 目标与范围

把 [t01](../t01-requirements/README.md) 确认的判据写进规则，并把现有的本地产物搬进新结构：

- `.local/README.md`：分 Agent 区 `agent/` 与用户区；Agent 区的目录布局；`artifacts/` 并入 `agent/`。
- `.agents/works/README.md`：Work 分仓库与本地两类；“本地与入库”的判据；改掉指向 `.local/design-review/` 的旧说法。
- `docs/testing/README.md`：截图与原始输出默认留本地。
- `.agents/skills/design-review/SKILL.md`：评审板与截图的路径。
- 搬迁：`.local/design-review/t80-settings-ui/`、`.local/design-review/t81-nb-ui/`、`.local/artifacts/` 下的文件搬进 `.local/agent/works/…`；t80、t81 分支上 README 里的路径随后在各自分支更新。

不做：编号规则（“唯一分配者人工协调”改成“经命令行领号”）等命令行可用后再改；不删除、不改写已入库的历史文件。

行为合同未变：只改治理规则与本地目录，不改 Spec。

## 当前状态

- 2026-10-12 完成：四处规则按 t01 确认的判据改写；`docs:check`、`governance:check` 无失败（列出的警告来自别的会话未提交的文件）。
- 搬迁：t80 的评审板（`index.html` 与 `r1/`–`r4/`）到 `.local/agent/works/w00017-application-runtime-architecture/tasks/t80-settings-ui/review/`，验收截图（`s2/`–`s4/`）到同一 Task 的 `shots/`；t81 的截图到 `tasks/t81-nb-ui-text-size-segmented/shots/`；`.local/artifacts/2026-09-30-platform-review.html` 到 w00017 的 Work 级 `review/`。`.local/design-review/`、`.local/artifacts/` 已删空。

## 下一步

t80、t81 分支上 README 里的旧路径在各自分支更新；t80 正在跑的 omp 审查结束后，把会话目录与报告从会话临时目录搬到 t80 的 `reports/`。
