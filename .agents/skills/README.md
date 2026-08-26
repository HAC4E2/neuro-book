# Agent Role Skills

这里保存与项目治理相关的、可被不同 Code Agent 宿主加载的 Skill 适配层。

角色行为的源规则在 `.agents/roles/<role>/AGENTS.md`，任务合同在 `.agents/tasks/AGENTS.md`；Skill 不复制这些规则，只负责把当前角色指向对应文件并要求按顺序读取。

项目不依赖 OMP。Claude Code、Codex、Cursor、OMP 或其他 Code Agent 都可以通过自己的启动方式读取同一份角色契约。

产品运行时的 Agent Skill 位于 `assets/workspace/.nbook/agent/skills/`，不要把开发流程角色混入产品资产。
- [`report/SKILL.md`](report/SKILL.md)：主动报告当前状态、证据、开发者动作和下一步。
- [`load_role/SKILL.md`](load_role/SKILL.md)：按 `pm`、`leader`、`tasker` 或 `reviewer` 参数加载 canonical 角色合同。
- [`writing-for-agents/SKILL.md`](writing-for-agents/SKILL.md)：编写 Agent 消费的 Skill、`AGENTS.md`、`CLAUDE.md` 与触发式上下文文档；修改 Skill 时同时读取 [`SKILL-MECHANICS.md`](writing-for-agents/SKILL-MECHANICS.md)。
- [`diagnosing-bugs/SKILL.md`](diagnosing-bugs/SKILL.md)：报错、失败和性能回归的诊断循环。
工作流路由优先服从根 `AGENTS.md`、`.omp/RULES.md`、当前 Spec、Issue/Project、Task 和角色合同；通用 Skill 只作为执行参考。本目录是开发 Agent 的治理适配层，不是产品运行时 Skill 资产；产品运行时 Skill 继续位于 `assets/workspace/.nbook/agent/skills/`。

这些是开发 Agent 的仓库内副本，不属于产品运行时 Skill。
