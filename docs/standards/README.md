# 工程标准

`docs/standards/` 保存跨功能域的编码与仓库协作流程。产品可观察行为仍以 [`../specs/README.md`](../specs/README.md) 登记的当前规范为准。

- [`code.md`](code.md)：按改动语言和文件类型触发的编码、注释、性能与审查标准。
- [`repository-workflow.md`](repository-workflow.md)：维护者 Issue、Task、Git、PR、合并和发布授权流程。

开发 Agent 的协作、汇报和决策合同位于根 [`../../AGENTS.md`](../../AGENTS.md)；文档职责、生命周期和 Reference 迁移合同位于 [`../README.md`](../README.md)。每项规则只维护一个真相源。

修改标准时同步入口指针，并运行 `bun run docs:check` 与受影响的治理测试。
