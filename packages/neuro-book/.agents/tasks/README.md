# 应用包 Task

本目录只承载根 `.agents/tasks/ownership.json` 登记为 `packages/neuro-book/.agents/tasks` owner 的完整 Task 目录。Task 名保持稳定，不添加 owner 前缀；Task 的 schema、角色、walkthrough、evidence 和状态规则统一遵循根 [`README.md`](../../../../.agents/tasks/README.md) 与 [`AGENTS.md`](../../../../.agents/tasks/AGENTS.md)。

## Owner 选择

调用方先读取根 ownership manifest：已登记 Task 精确解析到本目录；未登记 Task 精确解析到根 `.agents/tasks/`。不得按候选路径、编号猜测、模糊搜索或跨 root fallback；manifest 不可读、schema 不匹配或登记目录缺失时直接失败。
