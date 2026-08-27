# Agent Works

`.agents/works/` 是 current Work 与 Task 的唯一入口。Work 是 current Task 的强制容器；一个 Work 包含一个或多个 Task，并可通过 `issueId` 引用零或一个 GitHub Issue。Proposal 独立存在，可被多个 Work 引用。

## 目录与身份

```text
.agents/works/
└── w00001-work-title/
    ├── README.md
    └── tasks/
        └── t01-task-title/
            └── README.md
```

- Work 目录使用 `w`、五位非零序号和 kebab-case 名称，例如 `w00001-work-title`。
- Work README 使用 `schema: nbook.work/v1`，`workId` 与目录一致，`issueId` 为 `i<正整数>` 或 `null`。
- Task 目录在所属 Work 内使用 `t`、两位非零序号和 kebab-case 名称，例如 `t01-task-title`。
- Task README 使用 `schema: nbook.task/v2`，`taskId` 与目录一致，并指定唯一正式 `role`：`pm`、`leader`、`tasker` 或 `reviewer`。
- Task 不保存 `actionIssueId`、`agentWorkflow`、`kind`、`worktreeId` 或 `branchId`。Task 正文可记录目标、范围、产物和验证，供协作参考；治理门禁只校验身份、容器和 role。

## 创建与执行

Leader 按已知结果创建 Work，并在 `tasks/` 下创建至少一个可执行 Task。Tasker、PM 或 Reviewer 从 Task 的 `role` 加载 `.agents/roles/<role>/AGENTS.md`；CLI 使用 `--work <workId>`，需要具体 Task 时追加 `--task <taskId>`，显式 `--role` 必须与 Task role 一致。

需要隔离代码改动时，同一 Work 默认共享 `.worktree/<workId>`；branch 继续使用根规则的 `{type}/{refs}-{slug}`，其中 `refs` 使用 Work 编号。恢复时运行 `governance:context` 记录实际 worktree 与 branch；默认路径已属于其它仓库、Work 或不匹配 branch 时报告冲突并停止，不覆盖或另建第二身份。执行身份不写入 Work/Task frontmatter。

Task 产物按需写入所属 Task：叙事记录与 Reviewer 结论进入 `walkthroughs/`，原始命令输出或结构化证据进入 `evidences/`。没有对应产物时不创建空目录；目录、文件名与正文链接不作为治理门禁。

旧 `.agents/tasks/` 与包级 `.agents/tasks/` 只保存 legacy `nbook.task/v1` provenance，不接收 `nbook.task/v2`。历史名称、worktree、branch、PR 与 Task 不迁移。
