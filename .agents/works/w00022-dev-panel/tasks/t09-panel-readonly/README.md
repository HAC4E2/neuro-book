---
schema: nbook.task/v2
taskId: t09-panel-readonly
status: active
updated: 2026-10-12
---

# 面板服务与只读视图

## 目标与范围

按 [Proposal](../../../../../docs/proposals/dev-panel.md) 第八、九节与 [实施计划的 t09 一节](../t03-design/plan.md#t09-面板服务与只读视图)：Bun 面板服务（HTTP 与 WebSocket）、两个来源、请求校验与路径守卫；Vue 3 加 Vite 的前端（先验证 nb-ui 组件能否脱离 Nuxt 使用）；首页（收件箱加每个 Work 一张卡片）、Work 与 Task 页、产物页（第二个来源的 iframe 加只读问题侧栏）、文档页、会话页（只读）、搜索；`nbdev panel serve`、`panel open`、`panel.json`。视图依据 t03 第三轮与第二轮已定的静态稿（[评审板](../t03-design/artifacts/review/index.html)）。

行为合同未变：开发工具，不改产品 Spec；工具合同写在包内文档。

## 执行位置

集成分支 `feat/w00022-dev-panel`，worktree `.worktree/w00022-dev-panel`。

## 当前状态

2026-10-12 开工：编码子代理写 `plan.md`，交 opus 子代理做设计审查后实施。

## 下一步

`plan.md` 与设计审查。
