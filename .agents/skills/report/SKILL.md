---
name: report
description: Report the current repository and task state, evidence, developer action, and next step when work is long-running, blocked, needs review, or ready for handoff.
argument-hint: 'Request, file, decision, or task to report'
---

# Report

用本 Skill 生成面向开发者的当前状态报告；`$ARGUMENTS` 是报告对象、指定文件、审查请求或待决定事项。

## 先取证

1. 读取根 `AGENTS.md`、`.omp/RULES.md` 和当前路径最近的 `AGENTS.md`。
2. 有 Task 时读取唯一恢复集合：所属 Work、Task README、role 合同、授权来源、Spec 或“行为合同未变”依据、最新 walkthrough/evidence、实现 worktree 当前 diff；没有 Task 时读取当前 diff 和实际命令结果。
3. 只写已经观察到的状态、命令、退出码、revision、文件和风险；未运行项明确写“未运行”，不把旧证据当作最新验证。
4. `$ARGUMENTS` 指定文件或审查对象时，先读取它并把该对象列入“已确认”；指定批准、合并、发布、部署或其它不可逆动作时，只报告待授权动作，不执行动作。

## 调用例子

- `report 审查 scripts/ci/agent-governance-contract.ts`：读取指定文件，报告审查对象、已确认边界、发现和下一步修复。
- `report 阅读 .agents/works/w00001-development-workflow-governance/tasks/t01-work-task-model/README.md`：读取所属 Work 与指定 Task，报告当前状态、role、证据和继续执行动作。
- `report 请求开发者接受基线风险`：把唯一待决的人类动作、影响、推荐和回复后动作置顶，不执行远端或不可逆操作。

## 报告格式

按本 Skill 下方的“报告格式”执行；仓库授权、验证和远端边界仍以根 `AGENTS.md` 与 `.omp/RULES.md` 为准。顺序固定，结论先行：

### 回顾

> 分为三种，这一环节不仅仅是报告开发者指令，同时也可以确认你是否理解了开发者的意图。

1. 任务原始指令：可以查询当前 session 文件获取开发者输入的原始指令。（注意，开发者指令可能横跨多次上下文压缩，不要相信你当前记忆）
2. 你理解的指令
3. 实际执行的指令

### 当前状态

先输出固定“状态卡片”，不得省略以下字段；字段值只来自 Task/上下文和当前 Git 观察，不用旧证据覆盖当前状态：

| 字段 | 必填内容 |
| --- | --- |
| Work | `workId`、Work README 路径和 `issueId`；无 Work 写 `N/A（未创建 Work）`。 |
| Task/role | 可选 `taskId`、Task README 路径和 canonical `role`；无 Task 写 `N/A（Work 级报告）`。 |
| Issue/Project | Work `issueId` 与已观察到的 Issue/Project 状态；`issueId: null` 时写授权来源和“无 Issue/Project 例外”，不猜测编号或状态。 |
| Worktree | 当前 checkout/worktree 路径；主 checkout、其它 worktree或路径与报告对象不一致时单独列出。 |
| Branch | 当前 branch；detached HEAD 明确写出。 |
| Revision | 明列 `HEAD=<sha>`、`latest verified=<sha 或 HEAD + 当前未提交 diff（无独立 revision）>` 和 `一致性=<一致/不一致/N/A>`；验证覆盖未提交 diff 时必须说明“无独立 revision”，不能只写 HEAD。 |
| 提交状态 | `clean`、已提交但工作树有改动、暂存改动、未暂存改动、未跟踪文件等实际状态；不能因为存在 HEAD 就写“已提交”。 |
| Diff 范围 | 当前 staged/unstaged/untracked 改动是否都能由 Task 解释；其它 worktree 改动不并入本 Task。 |
| 远端动作 | push、PR、合并、发布、部署等尚未获授权的动作；无待授权动作写“无”。 |

工作树与提交状态以当前目录的 `git status --short --branch`、staged/unstaged diff 和实际 Task 记录为准；未执行的检查写“未运行”。状态卡片之后再写结论、证据和影响。

### 已确认与证据

列出实际完成的改动、相关文件、已运行检查及可观察结果。验证项使用人话名称，分别写通过、失败或未运行；required 的真实失败保留原文。

### 开发者现在要做什么

只提出解除下一安全步骤所需的最小动作，例如：

- “请审查 `path/to/file` 的边界；回复‘继续’后我读取调用方并验证。”
- “请接受列出的仓库基线失败；回复‘接受基线风险’后我保持失败原文并准备本地交付。”
- “请分别授权 push、PR、合并、发布或部署中的具体动作；一个授权不外推到其它动作。”

没有待决动作时写“无需开发者决定”。不要要求开发者先阅读内部文件才能回答。

### 下一步

写下一安全动作、解除条件和预计使用的验证；若存在阻塞，写回复前不会做什么。单一报告只前置一个阻塞，其它缺口列为后续检查。

## 完成条件

报告对象、当前状态、证据、开发者动作和下一步均有内容；每项验证与实际执行结果一致；阻塞、基线失败、未运行项和未授权远端动作没有被省略或改写。
