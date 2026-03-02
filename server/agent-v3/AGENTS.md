# Agent v3 局部约束

本目录用于从零建设 Agent v3。除非用户明确要求迁移生产链路，否则不要修改 `server/agent` 下的 v2 实现。

## 工作原则

- 当前阶段使用自研 NeuroAgent 模型/loop 和真实本地 shell tool，但不接真实数据库、前端状态或 v2 消息树。
- 代码优先 OOP 边界：Message、Model、Tool、Agent、Runtime 分开建模。
- 命名不要加 `V3` 前缀。使用 `AgentToolRegistry`，不要使用 `AgentV3ToolRegistry`。
- 接口、类型、逻辑文件分离。`*.types.ts` 只放类型/接口，普通 `*.ts` 放实现。
- 新增或修改 v3 行为时，必须同步更新 `server/agent-v3/PARITY.md`；如果影响仓库级状态，也要更新根目录 `PROJECT-STATUS.md` 和对应 `docs/tasks/<task-slug>/README.md`。
- v3 代码必须配套测试；测试允许真实调用 `deepseek/deepseek-v4-flash`。
- 多写中文注释，但要简洁。类和函数必须说明职责。
- TypeScript 代码缩进使用 4 空格。

## 禁止事项

- 不要从 v2 内部模块复用架构，只允许参考 v2 的逻辑细节。
- 不要在当前阶段引入真实 Prisma、HTTP API、SSE endpoint 或前端事件流。
- 不要在 `server/agent-v3` 运行核心中重新引入 LangChain/LangGraph。
- 不要为了兼容旧历史结构牺牲 v3 类型边界；兼容策略记录到 `PARITY.md`，重大取舍同步进入任务 walkthrough。
