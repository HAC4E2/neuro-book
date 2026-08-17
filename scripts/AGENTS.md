# scripts 目录规则

- 脚本是根应用、发布链和治理命令的宿主适配层；保持现有 CLI 名称、参数、退出码和调用路径。
- 领域逻辑留在对应 Module；脚本只编排现有能力，不为单次调用创建 wrapper。
- 需要测试、验收、缓存或 scratch 数据时读取 [`../docs/testing/README.md`](../docs/testing/README.md)，并使用 `scripts/utils/agent-paths.ts` 的 resolver；脚本默认不加载 `.env.local`。
- 新增或修改命令必须提供可执行入口、明确错误和覆盖可观察行为的聚焦测试。
- 发布脚本的安装图、输出和授权合同由 [`release/AGENTS.md`](release/AGENTS.md) 约束。
