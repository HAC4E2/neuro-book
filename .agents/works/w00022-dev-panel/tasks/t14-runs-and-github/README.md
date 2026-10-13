---
schema: nbook.task/v2
taskId: t14-runs-and-github
status: active
updated: 2026-10-13
---

# 运行登记、开发服务与现场补充

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第四节、第九节与 [实施计划的 t14 一节](../t03-design/plan.md#t14-运行登记开发服务与现场补充)，范围如下：

- 命令行：
  - `dev start`、`dev stop`、`dev status`：前台监管，日志写文件，打印 `READY <url>`，同一 checkout 复用，默认不停别人起的服务；
  - `worktree new <workId> <taskId>`：按规则命名，用 `/usr/bin/git`，写入 `home` 提示；
  - `find`；
  - `shot`，只做薄包装。
- 面板“现场”：
  - “在跑”显示数量与入口，含无主的运行；
  - checkout 列表；
  - GitHub 只读视图（`gh pr list`、`gh issue list`），没有任何写按钮。
- t12 推迟过来的普通 shell pane 的接管（t12 设计审查 S8）：只在计划里评估要不要做。

不做：`review start`、GitHub 写操作、“治理文件落后 master”的提示。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。

## 当前状态

- 2026-10-13 经 `nbdev task new` 新建。编码子代理写 [plan.md](plan.md)，写完交 opus 子代理做设计审查。

## 下一步

设计审查的结论处理完后实施。
