# NeuroBook Agent 治理

仓库级规则从根目录 [`AGENTS.md`](../AGENTS.md) 开始；`.agents/` 只保存可版本控制的 Agent 治理资料。

## 目录

- `roles/`：PM、Leader、Tasker、Reviewer 四个角色合同。
- `tasks/ownership.json`：稳定 Task 名到根/应用物理 owner 的唯一索引；解析失败不得跨 root fallback。
- `tasks/`：Task 规则、双根任务记录和正式证据索引。
- `skills/`：保留已有宿主适配草稿；本轮不扩展。

修改测试、fixture、验收或临时数据时读 [`docs/testing/README.md`](../docs/testing/README.md)；进入脚本、前端或 package 时读取最近的作用域 `AGENTS.md`。产品运行时使用的 `assets/workspace/.nbook/agent/skills/` 和 Project Workspace 内的 `.agent/` 不属于这里的开发治理资料。