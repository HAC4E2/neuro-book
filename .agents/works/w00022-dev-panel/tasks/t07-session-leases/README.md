---
schema: nbook.task/v2
taskId: t07-session-leases
status: active
updated: 2026-10-12
---

# 会话身份、运行归属与租约

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第四节与 [实施计划的 t07 一节](../t03-design/plan.md#t07-会话身份运行归属与租约)：`nbdev` 认出调用它的会话（Claude 会话、子代理、herdr 里的 Agent、会话派出的进程、`--as` 外部会话），Task 相关操作顺手取得或续期租约，失效按 herdr 会话列表与 24 小时计算；`lease take`、`lease list`、`release`；Task 改成 `done` 或 `shelved` 时自动释放；herdr pane 标签；运行的发现与归属；`status` 输出“谁在动”与各会话的运行。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。L4 测试在本机 herdr 里另建命名会话 `nbdev-test`，用完删除，不碰默认会话。

## 当前状态

- 2026-10-12 开工，[plan.md](plan.md) 写成后交 opus 子代理做设计审查（[报告](evidences/design-review.txt)）：2 阻断、5 重要、15 建议。主 Agent 核实两条阻断：本机 5 个会话由 `--resume` 或 `-c` 起，续期不刷新进程快照会让租约永久失效；codex 守护进程带着已不存在的 pane id，只按环境变量归属会把它算成运行。22 条全部采纳；改变租约失效字面含义等三条记入[待确认清单](../../pending-confirmations.md)。
- S1 到 S6 已在集成分支提交（`349c64d3`..`3e086d8e`，8 个提交）：herdr 客户端与两份白名单、`/proc` 读取、调用者识别、租约（续期重写会话快照、有效性现算、Task 关闭即无效）、运行发现与归属（只认工具标记，systemd 单元列为无主）、`lease take`、`lease list`、`release`、`--as`、核心库的 `setTaskStatus`、pane 标签、`status` 的 `caller`、`sessions`、无主运行；`docs/herdr.md`。偏差记在 [plan.md](plan.md) 的“实施中的偏差”。
- 主 Agent 复跑：包测试 79 通过（15 个文件，含在命名会话 `nbdev-test` 里跑的 L4，跑完 herdr 只剩 default 会话）；typecheck 通过；根上 174 通过。真实仓库只读 `status --json` 约 0.96 到 0.99 秒：调用者认作本会话（经 claude-env，pane w1:p16）；568d0811 名下有 w00005 的长任务；普通 pane 里的开发服务归无主。
- 未验证的边界：
  - 默认 herdr server 0.9.1 上的标签写入，合入后在真实会话上核对；
  - `omp -p` 的身份继承从源码推断；
  - 嵌套 `claude -p` 与后台会话；
  - `/clear` 是否换会话 id；
  - USER_HZ 为 100 的假设。

- 实现审查（opus 子代理，[报告](evidences/impl-review.txt)）：0 阻断、7 重要、13 建议。主 Agent 用真实 `status` 输出核实了 worktree 里运行的 checkout 被报成主工作区。20 条全部采纳，修正在集成分支 `f421ee8b`..`aff36ea2`（11 个提交），偏差记在 [plan.md](plan.md) 的“实现审查之后的改动”。
- 主 Agent 复跑：包测试 97 通过（18 个文件，含 L4）；typecheck 通过；根上 174 通过。真实仓库 `status` 约 0.87 秒，两个运行的 checkout 正确。
- 发现一处小问题，并入下一轮修：`identity.test.ts` 里 `sh -c "sleep 30 & wait"` 的用例只结束外层 `sh`，留下两个被 PID 1 收养的 `sleep 30`。

- 2026-10-13 主 Agent 的意外观察：t08 唤醒验证时，主会话对临时仓库运行了 `nbdev answers … --wait`（没加 `--as`），nbdev 给主会话在默认 herdr 上的 pane w1:p16 写了 `work=w00001`、`task=t01` 标签。由此核实：默认 server 0.9.1 能写入 tokens（`pane list` 里看得到），把值设为 null 能清掉（主 Agent 已经清掉）。暴露的问题：对别的仓库（临时仓库）的操作不该标到真实 pane 上。并入 t09：写标签前，确认 pane 的 cwd 在被操作仓库的某个 checkout 下，不在就不写。另外，herdr 0.9.3 的命令行 `pane report-metadata` 不认 `--source`，nbdev 走 socket 不受影响。
- 2026-10-13 开发者授权后，集成分支 `16cfb817e` 本地合入 `master`（合并提交 `3ef00987a`，没有 PR、没有 push master）；合并提交上复跑包测试 173 个、typecheck、`build:web`、根上三个测试文件 175 个、`governance:check`、`docs:check` 都通过。

## 下一步

无。已合入 `master`，标为 `done`。
