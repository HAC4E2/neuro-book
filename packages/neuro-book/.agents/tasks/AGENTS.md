# 应用包 Task Agent 指令

共享 Agent、Git、测试、证据和 Task 合同由根 [`AGENTS.md`](../../../../AGENTS.md)、根 Task [`AGENTS.md`](../../../../.agents/tasks/AGENTS.md) 与根 Task [`README.md`](../../../../.agents/tasks/README.md) 定义；本文件只声明应用 Task 的 owner 选择。

- 稳定 Task 名先在根 `.agents/tasks/ownership.json` 精确查找。
- 已登记 Task 只从本目录解析；未登记 Task 只从根 `.agents/tasks/` 解析。
- 不创建 owner 前缀、不模糊匹配、不在另一 root 兜底；manifest 或登记目标异常时失败。
- 历史 Task 正文、walkthrough 和 evidence 不因物理迁移批量改写。
