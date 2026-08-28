# .agents Agent 入口

目录用途和真相源分工见 [`README.md`](README.md)，通用入口见根 [`AGENTS.md`](../AGENTS.md)。非 OMP Agent 开始工作时显式读取 [`.omp/RULES.md`](../.omp/RULES.md)。本文件只定义 Agent 的加载动作：

- 执行 PM、Leader、Tasker 或 Reviewer 工作时，读取对应 [`roles/<role>/AGENTS.md`](roles/)；角色合同不替代 Issue、Project、规范或 Task。
- Leader处理或恢复尚无远端编号的Issue时读取[`issues/README.md`](issues/README.md)和`issues/drafts/`；草稿路径只作恢复键，不得写入`actionIssueId`。
- 创建、推进或审查 Task 时，先读 [`tasks/README.md`](tasks/README.md) 和 [`tasks/AGENTS.md`](tasks/AGENTS.md)，再读具体 Task 的 `README.md`、`context.md` 与相关 walkthrough。
- 修改测试、fixture、验收或临时数据时读取 [`../docs/testing/README.md`](../docs/testing/README.md)；进入 `packages/`、`scripts/`、`scripts/release/` 或 `app/` 时读取最近的作用域 `AGENTS.md`。
- `.agents/skills/README.md` 是本地 Skill 索引，不是角色合同、Task 或产品规范。