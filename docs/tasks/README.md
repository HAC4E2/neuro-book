# Task Walkthroughs

`docs/tasks/` 用来记录重大任务的持续过程。它不是一次性流水账，而是功能级、任务级的长期上下文。

## 何时创建或更新

- 会改变代码行为、架构决策、模块状态或长期 TODO 的任务，需要更新任务 walkthrough。
- 同一功能后续调节继续更新同一个任务目录，例如拆书功能继续写入 `docs/tasks/07-book-splitting/README.md`。
- 用户创建一个重要的讨论，或者架构设计

## 命名

- Active task 使用 `{order}-{name}` 目录名，例如 `01-config-system`、`02-book-splitting`。
- `order` 从 `01` 开始递增，不足两位补零（`01`–`09`），超过 99 后自然使用三位（`100` 起）；active task 按 README 首次加入 git 的时间正序编号，缺少 git 记录时使用目录 LastWriteTime。
- 新建任务目录前必须先 `ls docs/tasks/` 确认编号未被占用，不要凭记忆推断下一个编号（历史上已发生过 `08`、`96`、`120` 三次撞号）。
- `name` 使用英文 kebab-case。
- 每个任务目录至少包含 `README.md`。
- 并不一定强制都把任务塞到 README.md 里，还可以在任务目录类放其他和任务有关的文档等资料，例如 notes.md, references.md
- 任务量较重时，每一轮的实现报告放到该任务目录下的 `walkthroughs/` 子文件夹（注意拼写是 `walkthroughs`），`README.md` 只保留目标、决策、当前状态和指向各轮报告的链接。

## 归档

- `docs/tasks/archived/` 存放已归档 task，目录保留原 slug，不加 active 编号。
- 用户可以手动归档任务。
- 执行任务治理时，同时满足两个条件的 task 才移入 `archived/`：目录 LastWriteTime 早于当前时间约一个月，**且**没有任何外部文档反向链接到该任务目录。有外链的陈旧任务需要在归档的同一轮改写全部反向链接，不要留断链。
- 不要用 git 提交日期判断陈旧度：仓库存在批量提交，已跟踪任务目录的最后提交日期会被抹平成同一天，只能用文件系统 LastWriteTime。
- archived task 不参与 active 编号，也不要求继续维护 `PROJECT-STATUS.md` 同步状态。

## goal 模式工作流程

如果你正在持续推进某个任务，则按照这个流程循环进行：

调研/计划 -> 编码/实现 -> 测试 -> 浏览器测试 -> 代码审查 <-> 修复（回到代码审查） -> 调研/计划 或者 结束任务

最后应该从用户的角度，新建一个 project 跑一个实际的例子，评估这个系统的好用程度，bug。然后继续优化

注意：实现的过程中如果堵塞，可以尝试稍微绕道，但是每次绕道都必须在 walkthrough 文件中记录好。重大出入则记录到 README.md 中

## 同步要求

重大任务结束时同时更新：

- 根目录 `PROJECT-STATUS.md`
- 对应 active `docs/tasks/<order>-<task-slug>/README.md` 或 archived `docs/tasks/archived/<task-slug>/README.md`
