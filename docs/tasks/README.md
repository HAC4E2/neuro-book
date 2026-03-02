# Task Walkthroughs

`docs/tasks/` 用来记录重大任务的持续过程。它不是一次性流水账，而是功能级、任务级的长期上下文。

## 何时创建或更新

- 会改变代码行为、架构决策、模块状态或长期 TODO 的任务，需要更新任务 walkthrough。
- 同一功能后续调节继续更新同一个任务目录，例如拆书功能继续写入 `docs/tasks/book-splitting/README.md`。
- 纯问答、只读探索、无状态变化的失败尝试，不强制更新。

## 命名

- 使用英文 kebab-case，例如 `documentation-reorg`、`book-splitting`、`markdown-inline-code`。
- 每个任务目录至少包含 `README.md`。
- 需要额外资料时，可以在任务目录内添加 `notes.md`、`references.md` 或截图资源。

## 同步要求

重大任务结束时同时更新：

- 根目录 `PROJECT-STATUS.md`
- 对应 `docs/tasks/<task-slug>/README.md`
