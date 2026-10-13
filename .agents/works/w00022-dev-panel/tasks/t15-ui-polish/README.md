---
schema: nbook.task/v2
taskId: t15-ui-polish
status: active
updated: 2026-10-13
---

# 面板界面打磨

## 目标与范围

开发者 2026-10-13 试用面板后提出：

1. 左栏能调宽度；
2. 不用原生滚动条样式，参考 NeuroBook 的 UI 设计规范（[nb-ui 规范](../../../../../packages/nb-ui/docs/ui-development-spec.md)第 15 条）；
3. 页面还不够好，要系统审查并调优，扩展性与可维护性要紧。开发者指定派几个 sonnet 子代理在浏览器里体验审查 UI 与 UX，派一个 omp 从可维护性、健壮性审查前端设计。

行为合同：开发工具，不改产品 Spec；界面合同写在包内 [`docs/panel.md`](../../../../../packages/dev-panel/docs/panel.md) 的“前端”一节，改动随实现更新。

## 执行位置

先审查，后定方案；实现在集成分支 `feat/w00022-dev-panel`（worktree `.worktree/w00022-dev-panel`），从 `master` 同步后开工。

## 当前状态

- 2026-10-13 开发者同时在用 w00005 试 nbdev，会陆续提产品建议；审查不碰开发者在用的 4400 面板。
- 审查环境：在 `/dev/shm` 里另起一个面板（端口 4490），数据来自主工作区记录的稀疏克隆，herdr 用命名会话 `nbdev-ui-review`（一格假 Claude、两格 shell）；在这个面板上的写入只进克隆。说明与登录方法在本地 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/reports/review-env.md`。
- 已派出四路审查，报告与截图在同一本地目录的 `reports/`、`shots/`：
  - 三个 sonnet 子代理在浏览器里体验：信息架构与视觉层次（ux-a）、任务流程与交互反馈（ux-b）、滚动条、响应式与可访问性（ux-c）；
  - 一个 omp 只读审查前端代码设计（worktree `.worktree/w00022-t15-review`，detached 在 `5cf816f1c`），并给出左栏可调宽度与滚动条的实现方案、重构路线。

## 下一步

汇总四份报告，整理成改动方案先给开发者看，确认后写计划、实施。
