---
schema: nbook.task/v2
taskId: t14-runs-and-github
status: done
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

- 2026-10-13 实施完成（集成分支 `23402f959..c5177bc56`）：S1 开发服务、S2 `worktree new`、S3 `find` 与 `shot`、S4 面板现场三页与 `NBDEV_GH_BIN`、S5 文档，另修窄屏 checkout 表。各片的提交、浏览器验收 16 项与偏离见 [plan.md](plan.md) 的“实施进度”。
- 同一轮里修了 t11、t12 验收留下的两处（`c5177bc56..3be97d883`），见 [plan.md](plan.md) 的“追加修正”：
  - 通知误报：改为在投递窗口里看这一格的状态事件，不再比全局序号的差值；
  - 接管后又改一次尺寸：量尺寸时先藏起终端框的溢出。
- 主 Agent 在 `3be97d883` 上复跑，都通过：
  - 包测试 322 个，含 herdr 0.9.3 与 0.9.1 两组 L4、`dev-live` 10 条；
  - typecheck 与 `build:web`；
  - 根上三个测试文件 177 个，`dev-panel-records` 在 Node 下 5 个；
  - `governance:check`、`docs:check`、`git diff --check`。

  跑完没有残留进程，herdr 只剩 `default`。集成分支已 push。
- 验收只在临时仓库上做，没有在真实仓库上起开发服务、建 worktree。`gh` 只用假的。
- 未验证：
  - 真实 Claude Code 的 TaskStop、omp 的 `proc://`：只在测试里仿了 TaskStop；
  - 真实 master 与 w00017 的就绪行：只按源码写；
  - 默认 server 0.9.1 上状态事件的推送时序：L4 的状态事件测试只跑在 0.9.3。

- 2026-10-13 t14 的实现审查（[报告](evidences/impl-review.txt)）：1 阻断、4 重要、6 建议，设计审查 19 条里有 15 条已落实。主 Agent 定为全部采纳，已交编码子代理修正。
  - 阻断：GitHub 页开着、`gh` 又取不到数据时（没登录、找不到 `gh`、出错），推送、页面重取、再取会成环。实测没登录时 10 秒内调了 1 万多次 `gh`。
  - 重要：
    - 组号被另一个组长复用时，不加 `--force` 的 `dev stop` 也会停错进程组；
    - 开发脚本已退、只剩孙进程的运行也会被复用，打出一个连不上的地址；
    - 打出 `NOT_READY` 之后，监管进程不再读日志；
    - checkout 页不会按时重取。
- 2026-10-13 两处追加修正的实现审查（[报告](evidences/impl-review-fixes.txt)）：0 阻断、1 重要、3 建议。
  - 通知误报的修正成立：在 herdr 0.9.3 与 0.9.1 的命名会话里各实测一遍，别的格同时变状态时不再误报，这一格真的经过确认界面时照样报出。
  - 尺寸的修正只修好一半。滚动条那个原因已经消掉，但还有一个原因：xterm 按当前列数给格宽取整，从奇数列接管时仍会再改一次尺寸。在开发者原来报的“186 列变 187 列”上原样复现了（重要 1）。
  - 建议：
    - 旧记录里的 `state_jumped` 现在显示成最肯定的说法，应改弱；
    - 几处新判据补测试，新 L4 也在 0.9.1 上跑；
    - 包的浏览器验收规则补“去掉 `--hide-scrollbars`”。这一条是回写规范，等开发者批准。
  - 主 Agent 定为：重要 1 与前两条建议交编码子代理修正，第三条建议等开发者批准。

- 两批审查意见的修正（集成分支 `3be97d883..8d644d118`，14 个提交，已 push）逐条见 [plan.md](plan.md) 的“实现审查的修正”。偏离处理意见的有两处：
  - 复用到连不上的地址时报 `dev_unresponsive`，不替别人停服务；
  - 终端改按 xterm 的 `device.cell` 算列数，不再用 `@xterm/addon-fit`。
- 主 Agent 在 `8d644d118` 上复跑，都通过：
  - 包测试 338 个，含 herdr 0.9.3 与 0.9.1 两组 L4、`dev-live` 18 条；
  - typecheck、`build:web`；
  - 根上三个测试文件 177 个，`dev-panel-records` 在 Node 下 5 个；
  - `governance:check`、`docs:check`、`git diff --check`。

  试算合入 `master` 没有冲突，与主工作区未提交的改动没有交集。
- 待开发者批准的回写：在 `packages/dev-panel/AGENTS.md` 的浏览器验收规则里补一句：涉及尺寸、溢出或滚动时，去掉 `--hide-scrollbars`。

- 2026-10-13 开发者授权后，集成分支 `8d644d118` 本地合入 `master`（合并提交 `76a3da886`，没有 PR、没有 push master）。合并提交上复跑：包测试 327 个（herdr 的 L4 刚在内容相同的 `8d644d118` 上跑过，这次跳过）、typecheck、`build:web`、根上三个测试文件 177 个、`governance:check`、`docs:check` 都通过。
- 合入后：主工作区装了依赖（去掉了 `@xterm/addon-fit`），常驻服务按新单元重装，单元写入了 `NBDEV_GH_BIN`，前端构建完成，4400 回 200。
- 在场核对（临时仓库，假开发脚本，经真实 `bun run`）：在本会话里用后台任务跑 `nbdev dev start`，打出 `READY`，属主认成本会话；用 Claude Code 的 TaskStop 停掉后：
  - `normal` 形态：监管进程、组长、开发脚本、孙进程都退出，登记在 17 毫秒内写成 `ended`（`stopped`，`stoppedBy: signal:SIGTERM`），地址不再回应；
  - `owned` 形态（仿 master，运行时另起会话）：另起会话的运行时与它的孙进程同样退出，登记 `ended`（`stopped`）。
- 开发者同日批准回写 `packages/dev-panel/AGENTS.md`：涉及尺寸、溢出或滚动的浏览器验收去掉 `--hide-scrollbars`。
- 没做的：没在真实仓库上起主应用的开发服务（本机可用内存约 4G，别的实验在跑），master 与 w00017 的就绪行仍只按源码写；omp 的 `proc://` 没核实。

## 下一步

无。已合入 `master`，标为 `done`。下面几项在真实使用中顺带核对：

1. Agent 第一次在自己的 worktree 里用 `dev start` 起主应用时，核对就绪行与 `dev stop`；
2. 下一个新 Task 用 `worktree new`；
3. 开发者看一眼 GitHub 页；用桌面浏览器从奇数列的 pty 接管一次，pty 尺寸只变一次；
4. 下一次真实通知时，尝试记录的 `code` 是 null 而不是 `unwatched`。
