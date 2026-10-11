---
schema: nbook.task/v2
taskId: t76-bookshelf-polish
---

# 书架打磨一：品牌、字体、空态与新建流程

## 目标与范围

开发者 2026-10-11 看过新应用后要求逐页打磨到不差于旧应用，先从书架开始。对照旧应用的 `ProjectPickerView` 列出的差距与开发者的决定见 [plan.md](plan.md)。本 Task 做：

- 品牌成品（标志、字标、浏览器图标、看板娘心情组件）进仓库，nbook 主题的展示字体接上字标所用的 Fraunces 并补全中文宋体栈；
- 书架页：标题栏换成标志 + 字标，空书架换成带看板娘的引导卡，继续写作卡加看板娘，“进入工作台”改为“用户资产”；
- 新建流程：缺省作品目录（系统文档目录下的 `NeuroBook`）、不存在就建、路径输入认 `~`、对话框显示“将建在哪”并可更改、新建时就能选主题色、错误里写解析后的路径。

不做：封面图（提案已定）、题材标签、把 nbook 主题的强调色换成品牌色（主题层决定，另谈）、工作台与资源管理器的打磨（后续 Task）。

行为合同：[`workbench/bookshelf.md`](../../../../../docs/specs/workbench/bookshelf.md) 输出 1、2、11 改写（新增部分先标 planned）；[`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md) 的新建与登记补缺省作品目录与 `~` 解析（S2 时改）。

## 前置

[t75](../t75-bookshelf/README.md)（书架页）；品牌成品在开发者本机 `.local/brand/logo/06-production/`（2026-10-03 第三次交付）。

## 当前状态

- 2026-10-11 建立。开发者决定：品牌资产可以进仓库；看板娘放进空态卡与继续写作卡；字体按 Fraunces（拉丁）+ 系统宋体栈（中文）。
- 2026-10-11 S0、S1：品牌资产进仓库（`packages/neuro-book/src/ui/brand/`、`src/web/public/`、nbook 主题的 `assets/fonts/`）；字体栈；标题栏字标、`ShelfEmptyState`、继续写作卡与新建对话框的“位置”行先做成 Lab 静态稿给开发者看：[空书架](evidences/s1-empty-light.png)、[手机](evidences/s1-empty-phone-light.png)、[书脊视图](evidences/s1-spines-light.png)、[新建对话框](evidences/s1-create-dialog-light.png)、[继续写作卡（深色）](evidences/s1-continue-dark.png)。验证：typecheck；组件测试 16 例（新增 `ShelfEmptyState.dom.test.ts`、`ProjectInfoDialog.dom.test.ts`）；Lab 截图无溢出无报错；`docs:check`、`governance:check` 无失败。待开发者看过静态稿再做 S2、S3。
