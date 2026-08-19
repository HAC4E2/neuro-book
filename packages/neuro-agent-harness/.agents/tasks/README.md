# Task

`.agents/tasks/` 记录重大任务的持续上下文；Task 不是一次性计划，也不是 Issue 的副本。

## 何时创建或更新

- 跨模块、架构、公共合同、长期解耦或 goal 模式任务必须创建或复用一个 active Task。
- 同一功能的后续调整继续写入原 Task；跨任务或产品级跟进另行记录。
- 局部文档修正或单点小修复可以只由代码、测试和提交差异表达。

## 命名与目录

- active task 使用 `{order}-{name}`，例如 `01-harness-decoupling`；`order` 从 `01` 递增。
- 新建前先列出 `.agents/tasks/`，确认编号未占用；`name` 使用英文 kebab-case。
- 每个 Task 至少有 `README.md`，较重的实现计划和证据放在同目录的 `walkthroughs/`。
- 完成后移动到 `.agents/tasks/archived/<name>/`，保留原 Task slug。

## 协作循环

持续 goal 按以下顺序循环，不能把规划、实现和审查混成一次长运行：

```text
规划（可从多个角度派发只读调研）
  -> 计划任务（必要时记录 ADR）
  -> 执行
  -> 记录 walkthrough
  -> 收尾
  -> 代码审查
  <-> 修复
  -> 回到规划或结束
```

规划阶段可以并行派发独立的 API 形态、模块边界、迁移成本、测试缺口等只读调查；执行阶段由一个集成负责人收敛跨模块合同、冲突、文档和最终验证。不能让多个代理同时修改同一合同或同一文件。

每一轮都在 Task 的 `Implementation Walkthrough` 记录：做了什么、依据是什么、运行了哪些命令、结果如何、哪些仍未验证、是否绕道以及下一步。绕道不能只留在会话里。

参考 `$night-audit` 的可恢复原则：跨轮状态落盘，下一轮先重读 Task 状态，finding 需要函数名或代码片段等稳定证据。`$night-audit` 是只读巡检 skill；本 goal 的写入范围仍由 Task Goal 明确限定。

## Goal 模式

Goal 是 Task 的执行合同，不替代 Task。进入 goal 前必须已有 Task，并明确写出：

- 目标结果和验证面；
- 文件、仓库、数据和外部副作用边界；
- 不得回归的约束；
- 每轮选择下一步的规则；
- 无法继续时的阻塞停止条件。

用户未明确启动 goal 时，只完成调研、Task 建立和计划，不进入无人值守实现循环。

## ADR

影响公开 API、模块边界、持久化、恢复、Transport 或外部副作用的稳定决定，先在 Task 的 `ADR / Decisions / Discussion` 记录候选与证据；决定跨 Task 仍需有效时，再建立 `docs/adr/<slug>.md`。没有证据支持的偏好保持为讨论，不写成已确认合同。

## Task README 最小结构

```markdown
# <Task Title>

## Relative documents refs
## User Request / Topic
## Goal
## Current State
## ADR / Decisions / Discussion
## Verification / Test
## Implementation Walkthrough
## TODO / Follow-ups
```

## 完成与同步

Task 结束前必须更新对应 Task README、受影响的架构/合同文档和验证记录。若仓库建立了 `PROJECT-STATUS.md`，同时同步模块状态和未完成边界；本仓库当前以 Task README、`CONTEXT.md` 和 `docs/architecture.md` 为状态入口。
