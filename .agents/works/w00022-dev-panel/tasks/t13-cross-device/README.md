---
schema: nbook.task/v2
taskId: t13-cross-device
status: active
updated: 2026-10-13
---

# 跨设备访问

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第八节与 [实施计划的 t13 一节](../t03-design/plan.md#t13-跨设备访问)：手机等设备经 Tailscale Serve 使用面板。范围是设备配对、设备令牌、吊销与有效期；去掉对转发头的一律拒绝，改为认 Tailscale 转发来的请求；Tailscale Serve 两个端口的配置说明与检查命令；手机布局。

开发者 2026-10-13 的决定（见 Proposal 决策记录）：
- 现阶段先用 SSH 端口转发；
- 别的设备登录后与本机权限相同，不分“只看”与“可操作”两级，这改了待决问题 11 的推荐。

不做面板自带 TLS 的局域网直连，也不做 Tailscale funnel。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。

## 需要开发者授权或参与

- Tailscale Serve 的配置：它会改变网络暴露面，可能要先执行一次 `sudo tailscale set --operator=notnotype`。
- 用手机走一遍验收。

## 当前状态

- 2026-10-13 经 `nbdev task new` 新建。编码子代理写 [plan.md](plan.md)，写完交 opus 子代理做设计审查。

## 下一步

设计审查的结论处理完后实施。
