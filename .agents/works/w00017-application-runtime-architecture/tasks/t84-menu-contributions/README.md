---
schema: nbook.task/v2
taskId: t84-menu-contributions
status: active
updated: 2026-10-13
---

# 菜单贡献点

## 目标与范围

t83 验收反馈第 7 条：开发者问菜单系统做了没有，记得旧应用里有些视图能贡献菜单。2026-10-13 同意另开 Task：先对照旧应用的菜单贡献与新应用现有的菜单来源（标题栏菜单只列命令目录里的命令），定菜单贡献点的设计，交开发者确认后实施。

调研与设计稿见 [design.md](design.md)。

合同：设计定了之后改实现分支 `refactor/w00017-runtime-foundation` 上的 `docs/specs/ui/workbench-shell.md` 外壳四（标题栏菜单）与相关贡献点的 Spec（master 上的同名文件是旧应用的口径）。

## 当前状态

2026-10-13 经 nbdev 新建。同日调研完成并出设计稿（[design.md](design.md)）：旧应用里视图能往菜单加东西的只有编辑组工具栏的“视图动作”与视图标题的“更多”（后者没有使用者），新应用的标题栏菜单写死在工作台里。开发者同意第一版做四处菜单位置：标题栏菜单、视图标题的“更多”、资源管理器右键、编辑区标题（含按后缀的局部条件）；决定原文见设计稿末节。

## 下一步

写实施计划（plan.md，含 Spec 改动），交开发者确认后实施。代码在从 `refactor/w00017-runtime-foundation` 切出的 worktree 里改。
