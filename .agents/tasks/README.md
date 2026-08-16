# Agent Tasks

这里保存 NeuroBook 开发 Agent 的任务合同、角色交接和正式证据。Task 记录一次实现，不承担产品规范；当前行为从 [`../../docs/specs/`](../../docs/specs/) 的注册表进入。

## 真相源分工

- GitHub Issue：公开反馈、需求、决策去向和实现授权。
- GitHub Project：优先级、迭代、负责人和交付状态。
- `docs/specs/`：功能当前行为、状态、数据、接口、失败语义和验收真相源。
- `docs/proposals/`：尚未生效的跨模块方案；批准后先沉淀到规范。
- `.agents/tasks/<task>/README.md`：一次实现任务的执行合同。
- `.agents/tasks/<task>/walkthroughs/`：PM、Leader、Tasker、Reviewer 的追加式过程报告。
- `.agents/tasks/<task>/evidences/`：可被报告引用的截图、日志、JSON 和发布产物。

Task 不复制 Issue 的 `module`、`priority`、labels 或 iteration；变化只在 Issue / Project 更新。

## 目录结构

```text
.agents/tasks/
├── AGENTS.md
├── README.md
└── 00000-task-title/
    ├── README.md
    ├── context.md
    ├── evidences/
    └── 00000-role-YYYY-MM-DD_HH-mm-title.md
```

新任务使用五位数字编号和英文 kebab-case 标题。历史迁移任务保留原编号、目录名和正文，不为了格式统一重编号。

## Task README

新任务 README 使用最小 frontmatter：

```yaml
---
schema: nbook.task/v1
taskId: 00149-example
actionIssueId: 123
worktreeId: null
branchId: null
status: planned
createdAt: 2026-08-15T00:00:00Z
updatedAt: 2026-08-15T00:00:00Z
---
```

- `taskId`：任务目录的稳定身份。
- `actionIssueId`：获准执行的 GitHub Issue 编号，没有时为 `null`。
- `worktreeId`、`branchId`：实现 worktree 和分支身份，没有时为 `null`。
- `status`：`draft`、`planned`、`in-progress`、`blocked`、`verifying`、`completed` 或 `abandoned`。
- `createdAt`、`updatedAt`：任务记录时间。

状态只描述本次执行记录，不替代 Issue 或 Project 状态。

## Context、Walkthrough 与 Evidence

- `context.md` 是 Leader 在人类批准后生成的当前任务快照，记录生成时间和基线 revision；计划变化后重新生成，不成为新的项目真相源。
- 每个角色写独立、追加式 walkthrough，不覆盖已有报告。文件名使用 `<sequence>-<role>-<YYYY-MM-DD_HH-mm>-<title>.md`，frontmatter 至少记录 `schema`、`taskId`、`sequence`、`role`、`status` 和 `createdAt`。
- 正式脱敏产物进入 `evidences/`，报告使用相对链接引用。运行数据与敏感内容遵守根 `AGENTS.md` 的临时根和秘密规则。

## 新建任务

1. 人类批准 Issue 的目标、范围和验收条件；跨模块长期方案已经完成 Proposal/ADR 决策。
2. Leader 在 `docs/specs/README.md` 找到当前规范归属；新功能没有规范时先创建或更新规范。
3. Leader 检查任务编号并创建五位编号目录：`00000-kebab-case-title/`。
4. Leader 创建带 frontmatter 的 README，并记录 `taskId`、`actionIssueId`、`worktreeId`、`branchId` 和 `status`，链接当前规范与相关 Proposal/ADR。
5. Leader 生成当前 `context.md`。
6. Tasker 读取角色规则、当前规范、任务 README 和 context 后开始实现。
7. 每个角色将结果写成独立 walkthrough；Reviewer 核对代码、测试与规范一致后才提交人类合并决策。

## 历史任务

本目录迁移自旧的 `docs/tasks/`。历史任务保留原编号、目录名和内容，不为了迁移批量改写正文；旧目录入口在迁移提交中删除。新旧路径迁移由专门的治理脚本、清单 hash 和链接检查负责。
