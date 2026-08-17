# Project Status

截至 2026-08-17。本文只记录仓库级现状；具体 TODO 以 GitHub Issue 为准，实现过程与证据以对应 Task 为准，当前版本发布载荷以 [`RELEASE.md`](RELEASE.md) 为准。

## 一句话结论

NeuroBook 当前处于快速开发阶段，产品主线已收敛到 Novel 写作模式 v1；核心数据与运行时合同基本落地，主要缺口是 stable 发布、真实 Provider、完整浏览器流程和持续作者试用。

## 产品基线

- 普通写作入口是 Novel IDE / Markdown Studio；共享 Activity Bar 提供书架、文件、角色、剧情、World、Jobs/Trace/History、用户资产、账户和设置。
- 默认链路是“灵感探索 → Project / Lorebook → World Engine 初始化 → 剧情规划与状态推进 → 章节写作 → 写后回补与修订”。
- Project 内容以 `project.yaml`、`manuscript/`、`lorebook/`、`agents/`、`manual/`、`reference/` 和 `.nbook/` 为核心；RAG、RP、simulation 等历史能力不进入普通写作模式默认入口。
- 用户状态由 State Root 承载，可重建数据由 Cache Root 承载。App SQLite 位于 Workspace Root `.nbook`；Project SQLite 位于具体 Project Workspace `.nbook`。
- Product Application Root 只读；Profile/Variable 编译、用户同步与动态 import cache 写入 State Root。安装、发布与 Desktop 继续遵循现行 manifest 和 runtime contract。

## 核心模块状态

| 模块 | 当前状态 | 依据 |
|---|---|---|
| 写作模式 v1 | 主路径已完成，进入作者体验与修订反馈打磨 | [Task 124](.agents/tasks/124-writing-pipeline-batch3/README.md) |
| World Engine | 核心模型、API、Workbench 与作者主路径已实现 | [Task 56](.agents/tasks/56-world-engine/README.md)、[Task 71](.agents/tasks/71-world-engine-codeact-readwrite/README.md) |
| Plot | 承载树与因果树模型已落地，Scene 连接章节与 World Engine | [Task 93](.agents/tasks/93-plot-planning-layer/README.md)、[Task 99](.agents/tasks/99-plot-planning-ui/README.md) |
| Agent / Workflow | Session、Profile、Workflow、Job 与 Provider 主链路已实现；真实外部 Provider 和完整产品流程仍待验收 | [Task 104](.agents/tasks/104-pi-models-runtime-upgrade/README.md)、[Task 116](.agents/tasks/116-agent-workflow-reliability/README.md) |
| Project 生命周期与存储 | 生命周期、快照、路径与运行产物合同已实现；跨环境产品验收仍不完整 | [Task 118](.agents/tasks/118-project-catalog-snapshot-path-integration/README.md)、[Task 125](.agents/tasks/125-runtime-artifact-storage-lifecycle/README.md) |
| Product Runtime / Manager | Canary 的多平台 Product、Windows Portable、容器与公开资产链路已有证据；stable 与正式签名仍未完成 | [Task 105](.agents/tasks/105-unified-installation-manager/README.md) |
| Electron Desktop | Windows x64 内部 beta 的安装、UAC、Repair 与卸载路径已有证据；公开签名、updater、macOS 实包和完整原生交互仍未完成 | [Task 145](.agents/tasks/145-electron-desktop-productization/README.md) |
| Agent 资产安装 | 方案与 ADR 已形成，仍未完成产品实现 | [Task 135](.agents/tasks/135-agent-asset-install-protocol/README.md)、[ADR 0011](docs/adr/0011-agent-asset-install-identity.md) |

## 当前风险与验收缺口

- **发布**：当前公开版本仍是 canary；stable、公开签名、后台 updater 与正式 Desktop 发行未完成。历史版本和精确资产身份见 `vitepress/changelog/` 与对应 Task。
- **产品验收**：聚焦测试、typecheck 和构建不能代替浏览器、真实 Project Workspace、真实 Provider/Model 与作者视角写作 smoke。
- **Desktop**：Windows x64 内部 beta 已有阶段证据；原生 Snap、完整 SSE/WebSocket 断连矩阵、macOS 实包和公开 Desktop 资产仍缺。
- **写作产品线**：下一阶段是 dogfooding、章节写作与修订反馈、World Engine 体验，以及运行状态是否显式提交等产品决策。
- **架构债务**：shared/Manager 运行时依赖环、shared 与 `server/agent` 的类型环、大型 Facade 和 OpenAPI 生成物边界仍由 [ADR 0015](docs/adr/0015-architecture-boundaries-and-deferred-structure.md) 与相关 Issue 管理，不是已复现故障。
- **事务边界**：文件系统、Project SQLite、History SQLite、Session JSONL 与 Job JSON 不承诺全局原子事务；当前不引入分布式事务框架。
- **上游依赖**：Nitro dev source-map 临时补丁待上游稳定版本实际包含修复后移除。
