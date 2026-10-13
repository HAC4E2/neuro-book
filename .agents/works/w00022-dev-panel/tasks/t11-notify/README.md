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

## 下一步

设计审查的结论处理完后实施。
