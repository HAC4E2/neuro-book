# NeuroBook Agent 治理

仓库级规则从根目录 [`AGENTS.md`](../AGENTS.md) 开始；`.agents/` 只保存可版本控制的 Agent 治理资料。

## 目录

- `roles/`：Leader与Tasker组成顺序开发主线；PM负责按需远端元数据，Reviewer负责按需独立审查。四个canonical合同互不替代。
- `issues/`：未获远端Issue写入授权时的临时草稿与迁移规则；授权后先按Draft-Key查询，取得或复用编号后只建draft扁平Task，开发者接受后planned，闭合链接与授权留痕后最后删除草稿。
- `tasks/ownership.json`：稳定 Task 名到根/应用物理 owner 的唯一索引；应用owner当前Task固定关联Issue，解析失败不得跨 root fallback。
- `tasks/`：Task schema、Design密封diff、双根任务记录和正式证据索引。
- `skills/`：开发 Agent 的 `report`、`load_role` 和通用写作/诊断 Skill；角色合同仍是 `.agents/roles/<role>/AGENTS.md` 的唯一真相源。

修改测试、fixture、验收或临时数据时读 [`docs/testing/README.md`](../docs/testing/README.md)；进入脚本、前端或 package 时读取最近的作用域 `AGENTS.md`。产品运行时使用的 `assets/workspace/.nbook/agent/skills/` 和 Project Workspace 内的 `.agent/` 不属于这里的开发治理资料。