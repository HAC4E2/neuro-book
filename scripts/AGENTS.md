# scripts 目录规则

修改 `scripts/**` 前按扩展名读取 [`../docs/standards/code/README.md`](../docs/standards/code/README.md) 中对应脚本行：TypeScript/MJS、PowerShell/CMD、Bash 分别进入独立规范；只加载本次涉及的语言。

- 脚本是根应用、发布链和治理命令的宿主适配层；保持现有 CLI 名称、参数、退出码和调用路径。
- 需要测试、验收、缓存或 scratch 数据时读取 [`../docs/testing/README.md`](../docs/testing/README.md)，并使用 `scripts/utils/agent-paths.ts` 的 resolver；脚本默认不加载 `.env.local`。
- 发布脚本的安装图、输出和授权合同由 [`release/AGENTS.md`](release/AGENTS.md) 约束。
