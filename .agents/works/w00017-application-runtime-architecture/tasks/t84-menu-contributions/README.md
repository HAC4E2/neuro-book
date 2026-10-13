---
schema: nbook.task/v2
taskId: t84-menu-contributions
status: active
updated: 2026-10-13
---

# 菜单贡献点

## 目标与范围

t83 验收反馈第 7 条：开发者问菜单系统做了没有，记得旧应用里有些视图能贡献菜单。2026-10-13 同意另开 Task：先对照旧应用的菜单贡献与新应用现有的菜单来源（标题栏菜单只列命令目录里的命令），定菜单贡献点的设计，交开发者确认后实施。

合同：设计定了之后改实现分支 `refactor/w00017-runtime-foundation` 上的 `docs/specs/ui/workbench-shell.md` 外壳四（标题栏菜单）与相关贡献点的 Spec（master 上的同名文件是旧应用的口径）。

## 当前状态

2026-10-13 经 nbdev 新建，尚未开工。

## 下一步

调研：旧应用里哪些视图或插件贡献了菜单、贡献到哪里，新应用的标题栏菜单模型（实现分支上的 `packages/neuro-book/src/plugins/workbench/web/titlebar/menu-model.ts`）怎样承接；写出差距与设计稿交开发者确认。代码在从 `refactor/w00017-runtime-foundation` 切出的 worktree 里改。
