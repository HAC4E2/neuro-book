---
schema: nbook.work/v1
workId: w00022-dev-panel
issueId: null
---

# 开发者项目面板与本地／入库边界

## 当前结论与授权

2026-10-12 开发者在 t80（设置界面）的评审中提出：worktree、分支、`.agents` 的 Work 与 Task、`.local`、Issue、PR、界面设计稿、文档太散、太多，难以管理；希望有一个项目管理面板把它们收在一起，并作为 Agent 与开发者之间除会话窗口外的第二条沟通通道（Agent 用网页讲解，开发者在面板上填表、审查，回到会话说“填好了”）。

开发者已定：

1. 面板是独立的本地开发工具，放在 `master` 上，不做成 NeuroBook 插件；位置在 `packages/` 或仓库根目录，具体待定。
2. 本 Work 同时重新划定“哪些留在本地、哪些进 Git”：之前全部进 Git，后来引入 `.local/`，这次再优化一轮。
3. 先做需求分析与功能分析，再定方案。
4. 开发者用网页，Agent 用命令行；Work 与 Task 编号会撞的问题借这个工具一起解决。

本 Work 目前是纯规划，在主工作区维护唯一快照；进入实现时从 `master` 创建 worktree。

## Task

| Task | 当前范围 |
|---|---|
| [t01](tasks/t01-requirements/README.md) | 需求分析、功能分析与本地／入库边界的现状调查；2026-10-12 开发者全部确认，并定 Work 分仓库与本地两类 |
| [t02](tasks/t02-local-vs-repo-rules/README.md) | 按 t01 的判据改规则：`.local/` 分 Agent 区与用户区、Work 两类、验证与截图的入库边界、`design-review` 的路径；把现有评审板与本地产物搬进新结构。编号规则等命令行可用后再改 |
| t03 | 面板与命令行的设计：按 `design-review` 流程定首页注意力排序与静态稿，再写 Proposal 与实施计划；未开工 |
