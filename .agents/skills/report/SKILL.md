---
name: report
description: Report the current repository and task state, evidence, developer action, and next step when work is long-running, blocked, needs review, or ready for handoff.
argument-hint: 'Request, file, decision, or task to report'
---

# Report

用本 Skill 生成面向开发者的当前状态报告；`$ARGUMENTS` 是报告对象、指定文件、审查请求或待决定事项。

## 先取证

1. 读取根 `AGENTS.md`、`.omp/RULES.md` 和当前路径最近的 `AGENTS.md`。
2. 有 Task 时读取唯一恢复集合：授权来源、Spec 或“行为合同未变”依据、Task README、`context.md`、最新 walkthrough/evidence、实现 worktree 当前 diff；没有 Task 时读取当前 diff 和实际命令结果。
3. 只写已经观察到的状态、命令、退出码、revision、文件和风险；未运行项明确写“未运行”，不把旧证据当作最新验证。
4. `$ARGUMENTS` 指定文件或审查对象时，先读取它并把该对象列入“已确认”；指定批准、合并、发布、部署或其它不可逆动作时，只报告待授权动作，不执行动作。

## 报告格式

按本 Skill 下方的“报告格式”执行；仓库授权、验证和远端边界仍以根 `AGENTS.md` 与 `.omp/RULES.md` 为准。顺序固定，结论先行：

### 回顾

> 分为三种，这一环节不仅仅是报告开发者指令，同时也可以确认你是否理解了开发者的意图。

1. 任务原始指令：可以查询当前 session 文件获取开发者输入的原始指令。（注意，开发者指令可能横跨多次上下文压缩，不要相信你当前记忆）
2. 你理解的指令
3. 实际执行的指令

### 完成状态

### 当前状态

先输出固定“状态卡片”，不得省略以下字段；字段值只来自 Task/上下文和当前 Git 观察，不用旧证据覆盖当前状态：

| 字段 | 必填内容 |
| --- | --- |
| Task | `taskId`、Task README 路径、Task `status`；无 Task 写 `N/A（未创建 Task）`。 |
| Issue | 相关联的 issues |
| PR | 相关联的 PR |
| Worktree | 在哪个 worktree 完成的任务？ |
| Task Branch | 在哪个分支完成的任务？ |
| 提交状态 | `clean`、已提交但工作树有改动、暂存改动、未暂存改动、未跟踪文件等实际状态；不能因为存在 HEAD 就写“已提交”。 |
| 远端动作 | push、PR、合并、发布、部署等尚未获授权的动作；无待授权动作写“无”。 |

### 下一步

> 这一节的主动权在你

**如果任务未完成：**

发送命令请求开发者继续推进这个任务，例如：

- “请先阅读以下文档再判断： docs/path/to/file（文档介绍）”
- “请审查 `path/to/file` 的边界；回复‘继续’后我读取调用方并验证。”
- “请接受列出的仓库基线失败；回复‘接受基线风险’后我保持失败原文并准备本地交付。”
- “请分别授权 push、PR、合并、发布或部署中的具体动作；一个授权不外推到其它动作。”

**如果任务完成：**

写下一安全动作、解除条件和预计使用的验证；若存在阻塞，写回复前不会做什么。单一报告只前置一个阻塞，其它缺口列为后续检查。
