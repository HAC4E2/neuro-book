# Agent Role Skills

这里保存与项目治理相关的、可被不同 Code Agent 宿主加载的 Skill 适配层。

角色行为的源规则在 `.agents/roles/<role>/AGENTS.md`，任务合同在 `.agents/tasks/AGENTS.md`；Skill 不复制这些规则，只负责把当前角色指向对应文件并要求按顺序读取。

项目不依赖 OMP。Claude Code、Codex、Cursor、OMP 或其他 Code Agent 都可以通过自己的启动方式读取同一份角色契约。

产品运行时的 Agent Skill 位于 `assets/workspace/.nbook/agent/skills/`，不要把开发流程角色混入产品资产。

- 本目录保留可复用的开发 Skill 适配层；当前已纳入本地副本：[`diagnosing-bugs/SKILL.md`](diagnosing-bugs/SKILL.md)。它服务开发 Agent 的报错与性能回归诊断，不属于产品运行时 Skill。
