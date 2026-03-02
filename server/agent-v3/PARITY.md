# Agent v3 Parity

本文档持续跟踪 v3 与当前 v2 的能力差距。每次修改 `server/agent-v3` 后都要更新本文件。

## 当前阶段

- 阶段：NeuroAgent 内核替换
- 数据源：真实 `config.yaml` 模型配置 + 内存消息
- 目标：用 TypeScript 自研 NeuroAgent 替代 v3 runtime 对 LangChain/LangGraph 的依赖
- 最近更新：2026-04-28，新增 NeuroAgent message/model/tool/agent/SSE 内核，v3 runtime 已弃用 LangChain agent loop

## 分层对齐

| 能力域 | v2 位置 | v3 当前状态 | 下一步 |
| --- | --- | --- | --- |
| Profile / Context 装配 | `server/agent/profiles` | 未开始 | 等 runtime 稳定后再设计 |
| Variable / Scope | `server/agent/store`、`server/agent/variables`、`ThreadContextService` | 未开始 | 建立 watched variable baseline 与变更消息规则 |
| Model Provider | `server/utils/model.ts`、`runtime/model-provider.ts` | 已建立 OpenAI-compatible / DeepSeek ChatModel，使用原生 fetch | 后续再接 profile/thread model override |
| Tool Factory / Registry | `server/agent/tools` | 已建立 `AgentToolRegistry`、NeuroAgent tool wrapper 和 `execute_shell` | 增加 read/edit/write/apply_patch |
| Agent Runtime | `ThreadRunCoordinator` + `AgentThreadRunner` | 已建立 NeuroAgent `createAgent()`、流式/非流式/SSE 适配、内存消息 | 增加持久化与更完整状态机 |
| Thread 持久化 / 分支 | repositories、messages、mutation service | 未开始，仅内存线性消息 | 建模 conversation tree、branch cursor、rollback |
| Projection / Event | projection service、event registry、live run registry | 未开始 | 等 runtime 状态机稳定后再设计 |
| Skill | skill catalog、activated skill prompt | 未开始 | 明确 catalog、本轮激活、持久化边界 |

## 已知差距

- v3 暂无真实数据库持久化。
- v3 暂不做 checkpoint 持久化。
- v3 暂无消息分支树、回滚、刷新、激活分支。
- v3 暂无真实前端变量同步。
- v3 暂无 request_user_input 状态机。
- v3 暂无 subagent 多对多关系建模。
- v3 暂无 profile/context 装配层。

## 当前测试覆盖目标

- 验证 NeuroAgent message、ChatModel、agent loop、SSE adapter。
- 验证 DeepSeek 模型能返回正文、thinking/reasoning 与 usage。
- 验证 `execute_shell` 的成功、workdir 限制、截断、超时。
- 验证 runtime 能消费 NeuroAgent 事件并维护内存消息。
- 新增 v3 行为时，优先补充对应单元测试。
