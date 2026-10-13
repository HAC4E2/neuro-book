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

2026-10-13 开发者确认 [plan.md](plan.md) 并要求开工：一个 omp 审查计划与设计稿（与实现并行），实现完成后另一个 omp 审查代码。实施在 worktree `.worktree/w00017-t84-menu-contributions`（分支 `feat/w00017-t84-menu-contributions`，从 `refactor/w00017-runtime-foundation` 切出），按计划从 S0 开始。

- S0（`a9d258cd4`）：新建 `docs/specs/workbench/menus.md`，四份位置所在的 Spec 与注册表同步。
- S1（`e6c065a67`）：菜单项的共同合同（命令插件 `shared/menus.ts`）与测试，变异 8 处全部被抓到。
- 计划审查（omp）11 条全部属实，处理写在 [plan.md](plan.md) 末节“实施中的修订”，任务说明与报告在 [artifacts/omp-plan-review](artifacts/omp-plan-review/)。
