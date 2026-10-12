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

## 下一步

opus 子代理做实现审查（不阻塞），同时开始 t08。
