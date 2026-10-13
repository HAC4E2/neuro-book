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

- 2026-10-13 经 `nbdev task new` 新建。编码子代理写 [plan.md](plan.md)，写完交 opus 子代理做设计审查。

## 下一步

设计审查的结论处理完后实施。
