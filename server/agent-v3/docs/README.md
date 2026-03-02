# Agent v3 文档索引

Agent v3 是对当前 v2 Agent 系统的从零重建。当前阶段只建立模型、工具、运行循环的最小链路，对外不替换现有 v2。

## 文档

- `architecture.md`：当前 v3 分层和对象边界。
- `testing.md`：测试策略和覆盖要求。
- `../PARITY.md`：v2/v3 能力对齐表和迁移状态。
- `../../../PROJECT-STATUS.md`：仓库级状态总览。

## 当前阶段成功标准

- `server/agent-v3` 可以独立测试。
- v3 代码不依赖 v2 内部实现。
- model-provider 可以真实调用 `deepseek/deepseek-v4-flash`。
- runtime 可以用内存消息和 `execute_shell` 跑完流式 agent loop。
- 每次 v3 变更都更新 `PARITY.md`；重大变更同步更新仓库级状态和对应任务 walkthrough。
