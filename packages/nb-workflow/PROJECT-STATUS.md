# nb-workflow 项目状态

## 当前快照

- **身份**：`@notnotype/nb-workflow`，版本 `0.1.0`，Agent Workflow 编排 spike。
- **状态**：已按 S0 import manifest 收编到 monorepo；源 checkout 保持不变，不作为本包的开发路径。
- **范围**：保留脚本式 durable-execution 核心 API、demo、源码和测试；S3 起 NeuroBook 主应用直接消费本包正式入口，不扩展公开产品 API。
- **包治理**：monorepo 包设为 `private: true`；源 manifest 没有 `publishConfig` 或自动发布脚本入口，因此未引入发布语义变化。正式入口由 `exports["."]` 指向 `src/index.ts`，原有 `test`、`demo` scripts 与依赖保持不变。

## S0 导入验证

manifest 共记录 24 个 included 文件；其中 22 个按原相对路径复制并逐文件复核 bytes 与 SHA-256，`.gitignore` 和根 `bun.lock` 两项按约束跳过。复制后未发现 hash 或字节数不匹配。按本次任务要求未运行包测试、demo、typecheck、formatter、linter、build 或其他项目级验证。

## 文档与任务

项目说明和 S0 导入记录见 [`docs/README.md`](docs/README.md)。当前没有可迁入的历史 Task；Task 入口见 [`.agents/tasks/README.md`](.agents/tasks/README.md)。本状态页不编造 roadmap；未来项目行为变化按项目 Task 记录，跨项目事项由 monorepo 根治理协调。
