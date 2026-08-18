# 当前规范注册表

`docs/specs/` 是 NeuroBook 功能规范的统一入口。目标是让维护者或 Agent 只读取规范、ADR 和公开接口，就能重建模块的可观察行为；实现代码仍是执行载体，不承担未记录的产品决策。

本目录当前先做注册表，不复制现有正文。每项功能只有一个当前真相源；迁移完成前，注册表指向现有 `reference/`、`docs/modules/`、`docs/testing/` 或根规范文件。Monorepo / Module 的唯一正文仍在 [docs/modules/monorepo-boundaries.md](https://github.com/notnotype/neuro-book/blob/master/docs/modules/monorepo-boundaries.md)，不得另建 `docs/specs/architecture/monorepo-boundaries.md`。

## 规范应回答什么

每个功能规范至少说明：

- 用户目标、术语和不在范围内的内容；
- 可观察行为、状态转移、权限和失败语义；
- 持久化数据、文件、接口、事件和兼容承诺；
- 模块所有者、依赖方向和禁止依赖；
- 验收场景、验证入口和仍未覆盖的风险；
- 关联 ADR、migration、proposal 和实现入口。

实现细节只有在调用方必须依赖时才进入规范。文件清单、阶段进度、临时诊断和角色交接属于 Task，不写入功能规范。

## 当前真相源

| 功能域 | 当前规范 | 说明 |
|---|---|---|
| Agent Runtime 与 Profile | [Reference: Agent](https://github.com/notnotype/neuro-book/blob/master/reference/agent/README.md) | Session、Profile、Workflow、Skill、Job、Project Workspace 与 Agent 协作协议 |
| 内容与 Project Workspace | [Reference: Content](https://github.com/notnotype/neuro-book/blob/master/reference/content/README.md)、[Workspace TERMS](https://github.com/notnotype/neuro-book/blob/master/reference/workspace/TERMS.md) | 内容节点、正文、素材、检索、引用与 Workspace 术语 |
| World Engine | [Reference: World Engine](https://github.com/notnotype/neuro-book/blob/master/reference/world-engine/README.md) | 时间线、slice、subject、schema、calendar 与写作协作 |
| Plot | [Reference: Plot](https://github.com/notnotype/neuro-book/blob/master/reference/plot/README.md) | Story、Thread、Scene、Writer Brief、Agent 与前端合同 |
| Theme | [Reference: Theme](https://github.com/notnotype/neuro-book/blob/master/reference/theme/system.md) | 主题变量和消费规则 |
| Media | [Reference: Media](https://github.com/notnotype/neuro-book/blob/master/reference/media/image-variants.md) | 图片原图、变体、缓存和 Project 封面 |
| Character | [模块需求](https://github.com/notnotype/neuro-book/blob/master/docs/modules/character/requirements.md) | 当前需求与界面字段；尚待补齐状态和失败语义 |
| Monorepo / Module | [Monorepo 边界](https://github.com/notnotype/neuro-book/blob/master/docs/modules/monorepo-boundaries.md) | Monorepo 当前包布局、唯一文档真相源、包级继承/覆盖、依赖方向和 worktree 根边界 |
| 测试与验收 | [`../testing/README.md`](../testing/README.md) | 测试组织、临时根、验收和证据合同 |
| 人工评测 | [`../manual-eval/README.md`](../manual-eval/README.md) | 用户视角旅程、判定口径和报告结构 |
| 数据迁移 | [`../migrations/README.md`](../migrations/README.md) | 有状态升级、备份和回滚入口 |
| 贡献与交付 | [CONTRIBUTING](https://github.com/notnotype/neuro-book/blob/master/CONTRIBUTING.md) | Issue、开发、Git、PR 与维护者交付流程 |

## 尚未覆盖的功能域

以下功能已有代码、测试或 ADR，但还没有足以重建当前行为的完整规范。相关行为变更必须先补规范归属，不能只引用 ADR 或 Task：

| 优先级 | 功能域 | 现有证据 | 缺口 |
|---|---|---|---|
| P0 | Desktop、安装与 Product Runtime | `docs/adr/0010-*`、`0013-*`、`0014-*`、`0016-*`，`desktop/`、`scripts/install/`、`scripts/deploy/` | 安装状态机、UAC、启动/关闭、升级、卸载和失败恢复未汇成当前规范 |
| P0 | 应用状态、备份与数据迁移 | `docs/adr/0005-*`、`0008-*`、`0012-*`，`server/backup/`、`server/database/` | 数据所有权、备份恢复、catalog 演进和 release activation 未形成端到端规范 |
| P0 | Agent Session 持久化与历史 | `docs/adr/0003-*`、`0014-agent-job-*`，`server/agent/session/`、`server/workspace-history/` | durable event、Job 历史、附件、租约和文件历史缺少统一状态与恢复规范 |
| P1 | 配置、模型与凭据 | `server/config/`、`server/models/`、`shared/dto/app-settings.dto.ts` | 配置优先级、敏感字段、provider identity、错误和 UI 行为没有单一规范 |
| P1 | Markdown Studio 与编辑工作台 | [`../core/markdown-studio.md`](../core/markdown-studio.md)、[历史 editor plan](https://github.com/notnotype/neuro-book/blob/master/docs/archived/plan/06-editor-workbench.md)、`packages/neuro-book/shared/editor-workbench.ts` | 用户文档与历史 plan 存在，但需要按当前代码和测试核对后转成内部当前规范 |
| P1 | Passport 与身份 | `server/passport/`、相关 migration 与测试 | 登录、官方 origin、凭据存储和失败语义缺少当前规范 |
| P1 | Manager 与发布资产 | `packages/neuro-book-manager/`、`scripts/release/`、`RELEASE.md` | 安装身份、manifest、资产、健康检查和发布门禁分散 |
| P2 | Character 与 Low-code Form | `docs/modules/character/requirements.md`、`server/low-code-form/` | 需求存在，但状态、校验、持久化、权限和失败语义不完整 |

补齐顺序先覆盖会影响数据安全、安装与恢复的 P0，再覆盖外部配置与发布的 P1，最后补齐 P2 产品模块。

## 生命周期

1. 新功能先检查本表是否已有规范归属。
2. 尚未决定的跨模块方案写入 [`../proposals/README.md`](../proposals/README.md)；小型、可逆且不改变长期合同的工作可直接更新现有规范。
3. 提案获批后，先更新或创建当前规范，再创建 `.agents/tasks/` 实现合同。
4. 实现期间如果行为变化，规范和代码在同一变更中更新。
5. 验收以规范中的可观察行为为依据；Task 完成不能代替规范更新。
6. 旧行为退出时，更新当前规范；需要保留理由时写 ADR，需要用户升级步骤时写 migration。Task 和 proposal 保留历史但不再作为当前行为依据。

## 迁移原则

`reference/` 目前会被产品 Agent/Profile 的 Import、资产投影和测试直接消费，不能机械搬迁。本表是过渡期唯一索引。后续按功能域逐个执行 clean cutover：先确认消费者与链接，再移动正文并同步导入、测试、打包、VitePress 和规则指针，最后删除旧入口；任何时刻都不保留两份可独立修改的规范。