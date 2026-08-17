# Spec Agent 指令

规范模型、成熟度、格式和流水线统一见 [`README.md`](README.md)；创建或修改 Spec 时从 [`TEMPLATE.md`](TEMPLATE.md) 开始。本文件只规定 Agent 的执行步骤。

1. **定位能力**：先查 README 注册表和相邻 Spec。以可独立验收的行为确定 capability；找到现有文件就原地更新。完成标准：同一行为只有一个正文和一个稳定 capability。
2. **核实成熟度**：`planned` 必须有已接受 Proposal/明确人类批准；`implemented` 必须读取实现、调用方和相关测试。证据不足时保留较低成熟度并标明缺口。完成标准：状态不依赖文件名或推测。
3. **写黑盒合同**：逐项消除原始需求在输入、输出、状态、副作用、失败、权限、兼容和 smoke 上的歧义。完成标准：Tasker 不需要发明产品行为即可实现，Reviewer 可从场景判定对错。
4. **补实现合同**：仅对 `implemented` 记录 owner、接口、数据/事务边界、关键不变量、实现与验证入口。控制流和改动步骤写入代码或 Task。完成标准：内部重构不改变行为时无需重写 Spec。
5. **同步流水线**：更新 README 的正确成熟度表，链接 Proposal、Task、ADR、migration 和测试，不复制正文。完成标准：所有活跃入口指向本文件，Proposal 或 Task 不承担行为真相源。
6. **验证**：运行 `bun run docs:check`；行为或代码同步变化时再运行覆盖该合同的测试和实际 smoke。完成标准：报告区分已运行证据和未验证门禁。

遇到 Spec 与代码冲突时先判定哪一侧失真：代码偏离 `implemented` Spec 是 bug；规范错误则修正规范并保留依据；目标仍有产品歧义则回到 Proposal 或请求人类决策，不自行选择。