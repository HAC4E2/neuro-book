---
schema: nbook.work/v1
workId: w00022-dev-panel
issueId: null
status: active
---

# 开发者项目面板与本地／入库边界

## 目标

做一个本地的开发者项目面板（网页，开发者用）与命令行 `nbdev`（Agent 用），把散落在各分支、worktree 与本地目录里的 Work、Task、产物、文档与 Agent 会话收在一处：开发者在面板上看各 Work 的目标与 Task 状态、看产物并答复、经 herdr 接管或通知会话；任何 Agent 经命令行新建 Work 与 Task、发布产物、读答复。项目数据持久入库，会话与租约是临时的。

## 当前结论与授权

2026-10-12 开发者在 t80（设置界面）的评审中提出：worktree、分支、`.agents` 的 Work 与 Task、`.local`、Issue、PR、界面设计稿、文档太散、太多，难以管理；希望有一个项目管理面板把它们收在一起，并作为 Agent 与开发者之间除会话窗口外的第二条沟通通道（Agent 用网页讲解，开发者在面板上填表、审查，回到会话说“填好了”）。

开发者已定：

1. 面板是独立的本地开发工具，放在 `master` 上，不做成 NeuroBook 插件；后定为 `packages/dev-panel`（见 t03）。
2. 本 Work 同时重新划定“哪些留在本地、哪些进 Git”：之前全部进 Git，后来引入 `.local/`，这次再优化一轮。
3. 先做需求分析与功能分析，再定方案。
4. 开发者用网页，Agent 用命令行；Work 与 Task 编号会撞的问题借这个工具一起解决。

记录在主工作区维护（[记录只放主工作区](../README.md#记录只放主工作区)）；进入实现时每个 Task 从 `master` 建自己的 worktree。

## 实施

按 [Proposal](../../../docs/proposals/dev-panel.md)（2026-10-12 `accepted`）与 [实施计划](tasks/t03-design/plan.md) 推进。开发者 2026-10-12 指定开发者不在场时按 autonomous-delivery 的循环推进（计划、opus 子代理设计审查、实施、opus 子代理实现审查不阻塞、下一个 Task），本该开发者确认的点记入 [待确认清单](pending-confirmations.md)，事后追认。

- 实现 Task 严格先后依赖，共用一条集成分支 `feat/w00022-dev-panel`（worktree `.worktree/w00022-dev-panel`，从 `master` 分出）；互相独立的切片另开 worktree，再合回集成分支。
- 集成分支每次提交后 push 到 `origin` 作备份；合入 `master` 要开发者授权。
- 主会话调度，编码交给 opus 子代理；主会话审查 diff、自跑验证。

## Task

| Task | 当前范围 |
|---|---|
| [t01](tasks/t01-requirements/README.md) | 需求分析、功能分析与本地／入库边界的现状调查；2026-10-12 开发者全部确认（其中“Work 分仓库与本地两类”后被领域模型第二版取消） |
| [t02](tasks/t02-local-vs-repo-rules/README.md) | 按 t01 的判据改规则：`.local/` 分 Agent 区与用户区、验证与截图的入库边界、`design-review` 的路径；已完成，其中本地 Work 与产物留本地两条后被 t03 改掉 |
| [t03](tasks/t03-design/README.md) | 面板与命令行的设计：领域模型第二版、三轮静态稿（首页 Work 区用卡片）、Proposal 与实施计划；2026-10-12 完成，Proposal `accepted` |
| [t04](tasks/t04-rule-followups/README.md) | 已确认的规则跟进：worktree 一个 Task 一个（已完成）、Task 号允许三位、omp 会话目录改放 `.local/agent` |
| [t05](tasks/t05-migrate-records/README.md) | 把实现分支上维护的记录迁到主工作区、`.local/agent` 里的产物搬进 `artifacts/`；开发者定先只迁本会话建的，w00017 的 t80、t81 已迁，其余分支暂不动 |
| [t06](tasks/t06-cli-core/README.md) | 命令行核心：包骨架、写事务、记录读取与领号；2026-10-12 实施完成，实现审查进行中 |
| [t07](tasks/t07-session-leases/README.md) | 会话身份、运行归属与租约；2026-10-12 开工 |
