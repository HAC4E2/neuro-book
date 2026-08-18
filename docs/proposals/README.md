# 项目提案

`docs/proposals/` 保存尚未生效、需要评审的产品或工程方案。Proposal 用来决定“应该采用什么长期行为”，不是当前规范、实现 Task、待办清单或过程日志。

## 何时需要 Proposal

满足任一条件时创建 Proposal：

- 新增产品功能或改变用户可观察行为；
- 跨越多个模块、数据所有权或进程边界；
- 改变持久化格式、公开接口、权限、安全、安装、发布或兼容承诺；
- 存在两个以上长期方案，需要记录取舍和放弃原因。

局部修复、机械迁移和现有规范内的实现不单独创建 Proposal；它们直接进入 Task，并在需要时同步当前规范。

## 最小结构

每个 Proposal 使用英文 kebab-case 文件名，并包含：

1. `状态`：draft、reviewing、accepted、rejected 或 superseded；
2. `问题`：用户或系统面对的可观察问题；
3. `目标与非目标`；
4. `当前行为与证据`；
5. `方案、备选方案和取舍`；
6. `数据、接口、安全、迁移、发布与回滚影响`；
7. `对当前规范的预期改动`；
8. `决策记录`：日期、决策者和结论。

## 生效规则

- `draft` 和 `reviewing` 只供讨论，不能被代码、测试或 Agent 当作当前行为依据。
- `accepted` 只是批准修改规范和创建实现 Task；Proposal 本身不会自动成为规范。
实施前把被批准行为写入 [`../specs/README.md`](../specs/README.md) 注册的当前规范，并在 Proposal 中链接具体规范位置。
.agents/tasks/ 记录一次实现的范围、步骤、交接和证据；Task 引用 Proposal 与规范，不复制两者全文。
`rejected`、`superseded` 和已经完成沉淀的 Proposal 移入 [docs/archived/](https://github.com/notnotype/neuro-book/tree/master/docs/archived) 下的 proposals 分类；当前规范不依赖归档内容才能被理解。