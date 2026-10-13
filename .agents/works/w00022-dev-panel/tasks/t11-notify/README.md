---
schema: nbook.task/v2
taskId: t11-notify
status: active
updated: 2026-10-13
---

# 通知、会话消息与常驻

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第六节（通知）、第八节与 [实施计划的 t11 一节](../t03-design/plan.md#t11-通知会话消息与常驻)：

- 答复之后经 herdr 通知提问的会话（followup 与 steer、投递前核对、输入行检查、指针消息、失败处理、重启后现算的通知队列）；
- 会话已更换时弹小窗；没有可通知的会话时列出其它持有租约的会话；
- 会话页的输入框与按键按钮，herdr 适配层的方法白名单；
- 审计 `~/.config/nbdev/audit.jsonl`，并补上 t10 推迟的写仓库审计；
- 面板常驻：用户级 systemd 单元文件；
- 根 `AGENTS.md` 加 `[nbdev]` 一句。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。

## 需要开发者授权或参与

- 根 `AGENTS.md` 的改动；
- 建立 `~/.config/nbdev/`；
- 安装 systemd 单元（决定 9 已允许，安装时确认）；
- 向开发者的真实会话投递消息的验收（场景 1、2）。

## 当前状态

- 2026-10-13 经 `nbdev task new` 新建（nbdev 在真实仓库上第一次建 Task）。编码子代理写 [plan.md](plan.md)，写完交 opus 子代理做设计审查。

- 2026-10-13 设计审查（[报告](evidences/design-review.txt)）：1 阻断、7 重要、12 建议。审查在自建的命名会话里用假 TUI 实测了 herdr：
  - 阻断：herdr 认不出的确认界面与详细记录视图，状态一直是 `idle`，`agent.prompt` 照样写入粘贴加回车。投递判据要改成正向白名单：以只读的 `agent.explain` 认出空输入框才投。
  - 重要：
    - herdr 粘贴后固定约 300 毫秒才写回车，回车前不复查状态。会话工作中弹出的权限确认会被这个回车批准，steer 与“工作中仍然发送”都受影响；
    - 两个会话在同一个 Task 提过问时，先确认的一方会让另一方的通知消失；
    - 启用时刻与尝试记录放在同一个目录；
    - 用 `--resume` 续接的会话与超过 24 小时的租约被误判为没有可通知的会话；
    - `[nbdev]` 一句授权太宽，要改成只许读答复与带游标确认两条命令；
    - S0 探针有四处跑不通；
    - 场景 3 的测法造不出“会话已更换”。
- 主 Agent 的处理：全部采纳。steer 与“工作中仍然发送”按推荐先不做，只投空闲、空输入框的会话，记入[待确认清单](../../pending-confirmations.md)；`[nbdev]` 一句改成白名单写法，等开发者批准。

- 2026-10-13 实施完成（集成分支 `c896a742..0e3a40c9`，已 push）：S0 取样、S1 到 S7，以及根 `AGENTS.md` 的 `[nbdev]` 一句（单独放在最后一个提交 `0e3a40c9e`，开发者不批准就丢掉）。各片的提交、S0 结论、浏览器验收 24 项与偏离处理意见的地方见 [plan.md](plan.md) 的“实施进度”。
- 主 Agent 复跑：包测试 251 个（含 L4：名为 `claude` 的假界面上，负样本一个字节都不写，空输入框可投，按键字节对得上，换了会话 id 就拒绝）、typecheck、`build:web`、根上三个测试文件 177 个、`dev-panel-records` 在 Node 下退出码 0、`governance:check`、`docs:check` 都通过；没有建 `~/.config/nbdev/`，没有装 systemd 单元，herdr 只剩 `default`。
- 偏离处理意见、要开发者知道的：真实 Claude 2.1.296 的空输入框里有暗色占位文字，判据放宽为“`❯` 之后不暗的文字为空，且 herdr 的预览与屏幕上那一行一致”（粘贴会替换占位，回车提交的是面板的文字）。
- 主 Agent 看截图发现一处 t09 就有的问题：暗色模式下，iframe 里没有自带背景色的产物页是深底黑字，几乎看不清，交实现审查一并看。
- 未验证：y、n 能不能回答 Claude 的确认界面；真实 Claude 的 `/compact` 会不会改会话 id；默认 server 0.9.1 上的 `agent.prompt`、`agent.send_keys` 与状态事件；对真实会话的投递（只在开发者在场的场景 1 做）。

- 2026-10-13 开发者全部同意：根 `AGENTS.md` 的 `[nbdev]` 一句按 `0e3a40c9e` 的原文合入；实现审查修完后合入 `master`；合入后运行审计初始化（建 `~/.config/nbdev/`）、安装 systemd 用户服务；开发者在场时做场景 1（会在 `master` 上留下登记题、答复、确认、撤回四个提交）。

- 2026-10-13 实现审查（[报告](evidences/impl-review.txt)）：0 阻断、5 重要、4 建议，设计审查 20 条都有对应实现。主 Agent 定为全部采纳。
  - 重要：
    - 颜色解析把 RGB 与 256 色参数里的 `2` 当成暗色，带颜色的真输入被判成空、可投（在命名会话里复现）；
    - `[nbdev]` 规则要求“自己提过问的 Task”，与“发给现在的会话”“通知持有租约的会话”两条手动路径冲突；
    - 读答复去掉 `--unacked` 后，对每个产物 `ack` 会落到没有答复的产物上，输出也变长约 4 倍；
    - 收口时一个失败的发送会让 `server.stop()` 后半段被跳过，进程不退；
    - 同一会话在两个 Task 上有待发通知时形成活锁，两条都发不出去。
  - 主 Agent 对第 2 条的处理：规则不放宽。两条手动路径改为以开发者的名义发一段可编辑的普通消息，不带 `[nbdev]` 前缀，由开发者确认后发出。
  - 第 3 条：指针消息与规则改为按消息里列出的产物逐个读、逐个确认。规则原文随之小改，再给开发者看。
- 开发者在主工作区手动起的面板（04:09 起，pid 3751249）约 05:20 收口退出：`panel.json` 与锁都已删，像是终端关闭时收到 SIGHUP；审查没有对它发过信号。

- 实现审查的修正（集成分支 `0e3a40c9..3f474ce4c`，12 个提交，已 push）逐条见 [plan.md](plan.md) 的“实现审查的修正”：
  - 旧的根 `AGENTS.md` 一句用 `git revert` 撤掉，改写后的放在最后一个提交；
  - 另加：没有桌面环境时，`panel open` 提示 SSH 转发，文档补上“从别的电脑用”。
- 主 Agent 复跑：包测试 254 个（含 L4）、typecheck、`build:web`、根上三个测试文件 177 个、`dev-panel-records` 在 Node 下退出码 0、`governance:check`、`docs:check` 都通过。

- 2026-10-13 按开发者授权，集成分支 `3f474ce4c` 本地合入 `master`（合并提交 `23f604ebf`，没有 PR、没有 push master），根 `AGENTS.md` 的 `[nbdev]` 一句随之生效。合并提交上复跑：包测试 251 个（L4 刚在 `3f474ce4c` 上跑过，包内容与它相同，这次跳过以免与 t12 的命名会话冲突）、typecheck、`build:web`、根上三个测试文件 177 个、`governance:check`、`docs:check` 都通过。
- 2026-10-13 运行审计初始化：`~/.config/nbdev/` 权限 700，`audit.jsonl` 与 `init.json` 权限 600，启用时刻 `2026-10-13T05:13:06Z`；这之前的答复不自动通知。

- 2026-10-13 开发者停掉手动起的面板后，按授权运行 `install-service`：`~/.config/systemd/user/nbdev-panel-neuro-book.service` 已 `enable --now`，状态 `active`，约 1 秒预热完成，日志在 `journalctl --user -u nbdev-panel-neuro-book.service`。

## 下一步

开发者在场时做场景 1；之后标为 `done`。
