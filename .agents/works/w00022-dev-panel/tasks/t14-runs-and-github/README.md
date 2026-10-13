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

- 2026-10-13 设计审查（[报告](evidences/design-review.txt)）：1 阻断、6 重要、12 建议，主 Agent 定为全部采纳。
  - 阻断：按进程组停服务停不掉 master 的 `dev`。owned-process 让运行时另起会话与进程组，监督器先被杀，运行时成了孤儿，HTTP 照样回应，nbdev 却判“已停”。
  - 重要：
    - “还活着”不能只看组长：组长退出后孙进程还留在组里；
    - 复用的两处没有定义；
    - checkout 页“未提交”的缓存是错的；
    - 场景 4 的测法与现有代码冲突；
    - 作为 systemd 服务找不到 `gh`，要由 `install-service` 写入 `NBDEV_GH_BIN`；
    - 验收漏了监管进程被 SIGKILL、孙进程另起进程组、TaskStop 的情形。
  - S0 实测：
    - `bun run` 会把 SIGTERM 转给脚本；
    - `kill(-pgid)` 打得到同组的孙进程，打不到另起进程组的后代；
    - TaskStop 先 SIGTERM，约 1.5 秒后 SIGKILL。

## 下一步

按处理意见改计划并实施。
