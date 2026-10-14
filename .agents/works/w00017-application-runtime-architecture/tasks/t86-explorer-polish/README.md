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

## 决定

第一轮（2026-10-14，评审板 v1 的答复 `20261014T034813624Z-cf13a7aa`）：

1. 缩进参考线：做成可选、可配置，照 VS Code（不显示、悬停时、一直显示）。
2. 普通文件夹按中文数字与阿拉伯数字的数值排序：改。
3. 隐藏 `.md` 扩展名：做成可选、可配置；缺省怎样待定（VS Code 没有内置这一项，要自己定缺省与改名时的显示）。
4. 文件类型图标：改；现有图标不够用，要引入成套的图标素材，开发者举了 [catppuccin/vscode-icons](https://github.com/catppuccin/vscode-icons)。
5. 只有正文的节点不可展开：改；并且不要“空目录”“清单不合法”这种占一行的状态展示，换别的形式。
6. 内容文件夹的样子（名字去后缀、图标同文件夹家族）：改。
7. 两个根的样子：改；A（分节标题）还是 B（两个可折叠分节）下一轮出稿再定。
8. 标题动作：不改。
9. 右键菜单（快捷键右对齐、阴影、补打开与复制路径）：改。
10. 过滤框：这次做。
11. 章节字数：先不改；要做得系统性地做，不加特例。

开发者另提：资源管理器的拖动问题很多，要参考旧应用的拖动行为重做。

## 下一步

对照旧应用的拖动行为列出差异；第二轮静态稿：图标（catppuccin）、缩进参考线、状态的新展示形式、内容文件夹、两个根 A 与 B、右键菜单、过滤框，以及可配置项放在哪里。
