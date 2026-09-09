---
schema: nbook.task/v2
taskId: t01-construction-plan
role: leader
---

# 详细施工计划

## 目标与授权

2026-09-08 开发者要求只做规划，随后明确同意上游 Tool/Tail 默认提示词原文逐字一致，并要求施工计划消除后续 Agent 的歧义及多余施工。

本 Task 产物是 [construction-plan.md](construction-plan.md)。本 Task 阶段只读取上游、两个指定 JSON 和本地实现，并编写本 Work 的规划文档；没有执行预设中的指令，没有修改产品源码、默认配置或 Spec，没有调用模型，也没有进行远端写入。后续产品实现由同一 Work 的 t02 Task 在隔离 worktree 完成。

## 结果与恢复

已完成源码级差异核对、固定上游 commit、默认文案指纹及输入样本指纹登记。规划阶段没有运行产品测试或真实模型验收；产品实现、离线测试和实现证据见同一 Work 的 t02 Task。施工计划正文已追加 A–E 阶段的实际完成状态，真实模型、浏览器人工验收和远端动作仍未执行。

恢复时先读 Work README、本文和施工计划。用户尚未明确开始实施时，只继续讨论或修订计划。开始实施后由 Leader 补目标 Spec、创建指定 Tasker 的实现 Task；不把本规划 Task 改成实现 Task。

## 本轮验证与状态

- 规划阶段的 `bun run docs:check` 和 `bun run governance:context -- --work w00007-chatu8-toolcall-alignment --task t01-construction-plan` 均通过；当时只验证规划文档。
- 产品实现阶段的命令、退出码和 11 个测试文件 / 123 个测试结果记录在 t02 Task 的 `evidences/verification.md`；实现 worktree 的 `bun run governance:check` 已通过。

规划阶段 checkout 为 `D:/neuro-book-new-text-to-picture`，分支 `new-text-to-picture`，HEAD 为 `4e0347fe1a61952a3062196a79e0cba49cde88cf`。本 Task 文档未跟踪、未提交，没有独立 revision；实现 revision、文件清单和主工作区隔离情况记录在 t02 Task。当前 checkout 的既有 staged 改动不属于本 Work，不纳入实现提交或回滚。无远端动作。
