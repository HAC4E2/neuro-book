---
schema: nbook.task/v2
taskId: t86-explorer-polish
status: active
updated: 2026-10-14
---

# 资源管理器打磨

## 目标与范围

打磨工作台左侧的资源管理器（文件树）前端组件：先截现状、对照旧应用，与开发者确认要改的点与注意力排序，静态稿评审定稿后实施。走 nbdev 流程（评审板、提问与答复、dev 与 shot），流程上的问题随时记下交 nbdev 优化。

合同：[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md)；要改哪些等第一轮评审定。组件文档 `packages/neuro-book/src/plugins/explorer/web/components/` 的 `ExplorerRow`、`ExplorerTree`、`FilesExplorerView`。

执行位置：`.worktree/w00017-t86-explorer-polish`，分支 `feat/w00017-t86-explorer-polish`（经 `nbdev worktree new` 从 `master` 创建）。评审板：[artifacts/review](artifacts/review/index.html)。

## 当前状态

- 2026-10-14 经 nbdev 新建。现状截图：开发服务（`nbdev dev start`）里的样例作品“雾港”（本地 `.local/agent/works/<本 Work>/tasks/t86-explorer-polish/sample/`，三层正文、一个内容文件夹、图片与长文件名），以及 `nbdev shot` 截的 Lab `FilesExplorerView` 场景；原图在本地 `shots/`。
- 第一轮评审板列出 11 条看到的问题（缩进参考线、中文数字排序、`.md` 扩展名、文件类型图标、只有正文的节点可展开、内容文件夹的样子、两个根、标题动作、右键菜单、过滤框、章节字数），逐条问改不改。

## 下一步

等开发者在面板上答第一轮；按答复定范围与注意力排序，再出静态稿。
