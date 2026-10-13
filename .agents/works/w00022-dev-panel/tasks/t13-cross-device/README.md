---
schema: nbook.task/v2
taskId: t13-cross-device
status: shelved
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

- 2026-10-13 开发者决定先不做 Tailscale：现在的 SSH 端口转发加 systemd 常驻服务已经够用。本 Task 搁置；进行中的设计审查已停，没有出报告。[plan.md](plan.md) 留作以后的起点，其中只读查到的事实（tailnet 里有别人的设备、回环上能伪造 Tailscale 身份头、tailnet 没开 HTTPS 证书）以后重启时要重新核实。

## 下一步

无。要跨设备访问时再从 plan.md 接着做设计审查。
