---
schema: nbook.task/v2
taskId: t12-web-terminal
status: active
updated: 2026-10-13
---

# herdr 网页终端

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第七节与 [实施计划的 t12 一节](../t03-design/plan.md#t12-herdr-网页终端)：

- xterm.js 渲染 herdr 的终端帧，每个浏览器连接对应一个 `herdr terminal session observe` 子进程；
- 接管键盘（`control --takeover`、resize、`terminal.input`、release），离开、切后台、断线时交还控制权；
- 按键按钮；手机上以纯文本视图（`agent.read --source recent-unwrapped`）加输入框为主；
- 接管前的提示与审计。

不做鼠标事件，也不在面板里启动新会话。跨设备访问在 t13；开发者 2026-10-13 定别的设备登录后与本机权限相同。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。

## 需要开发者参与

- 在真实 pane 上接管一次键盘（验收）。在那之前，不对默认 herdr 里的任何真实 pane 接管或输入。

## 当前状态

- 2026-10-13 经 `nbdev task new` 新建。编码子代理写 [plan.md](plan.md)，已交 opus 子代理做设计审查。
- 2026-10-13 开发者同意：S0 对默认 herdr 里一格空闲的真实 pane 起一次只读的 observe，只核对 0.9.1 能不能出帧；不改尺寸、不输入，屏幕内容会经过编码子代理的进程。

- 2026-10-13 设计审查（[报告](evidences/design-review.txt)）：0 阻断、2 重要、17 建议，主 Agent 定为全部采纳。
  - I1：`pane.layout` 的矩形含边框，推不出真实列数；尺寸改从 pane 的 pty 读（`pane.process_info` 找到 shell 的 `/proc/<pid>/fd/0` 再 `stty -F`），读不到就不改回。
  - I2：默认 server 跑的 0.9.1 二进制可以从它的进程复制出来，放在命名会话里当 server 验证。审查已验证 observe、control、resize、争抢与 release 都可用。所以 S0 不再对真实 pane 起 observe，开发者先前的同意不再需要用上。二进制已复制到本地 `.local/agent/works/w00022-dev-panel/tasks/t12-web-terminal/herdr-0.9.1/herdr`（不入库，默认 server 一重启就拿不到了）。
  - 建议里改动较大的：
    - 普通 shell pane 的接管推迟到 t14（S8）；
    - systemd 单元加 `KillMode=mixed`（S3）；
    - 子进程与互斥按 terminal id（S5）；
    - 接管握手加时限（S7）；
    - 切到后台时观看也停（S9）；
    - 为 t13 预留：终端连接记下登录会话（S10）。

## 下一步

编码子代理修完 t11 实现审查的问题后，按处理意见改计划并实施。
