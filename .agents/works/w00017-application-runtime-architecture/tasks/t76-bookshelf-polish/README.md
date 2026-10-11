---
schema: nbook.task/v2
taskId: t76-bookshelf-polish
---

# 书架打磨一：品牌、字体、空态与新建流程

## 目标与范围

开发者 2026-10-11 看过新应用后要求逐页打磨到不差于旧应用，先从书架开始。第一版静态稿之后开发者提了六点（第一屏、两个入口、路径输入、表单与错误落点、光晕裁切、通知去处），经五轮静态稿定下设计，见 [plan.md](plan.md)。本 Task 做：

- 品牌成品进仓库，nbook 主题的展示字体接上 Fraunces 并补全中文宋体栈（已完成）；
- 通知：三个去处的规则、nb-ui 的队列可实例化、`Banner`、进度，工作台的通知服务与右下角视口；Lab 工具条光晕裁切修复与 `lab:shot` 机检；
- 服务端：缺省作品目录、不存在就建、`~`、`library`、`browse`、封面；
- 两个 `DialogWindow`（新建作品、打开已有作品）与通用文件/目录选择器；
- 书架页重排：标题栏（设置、头像预留）、案头（统计、最近写到、看板娘）、封面、卡片与列表视图、空态；删除书脊组件。

不做：通知中心、活动栏角标、系统通知、连接状态横幅的使用者、品牌色进主题、个人资料、工作台与资源管理器的打磨（后续 Task）。

行为合同：新增 [`workbench/notifications.md`](../../../../../docs/specs/workbench/notifications.md)（planned，实现后待晋升）；[`workbench/bookshelf.md`](../../../../../docs/specs/workbench/bookshelf.md) 输出 1 到 12 改写；[`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md) 第 13、14 条与新增的 `library`、`browse`、封面路由。

## 前置

[t75](../t75-bookshelf/README.md)（书架页）；品牌成品在开发者本机 `.local/brand/logo/06-production/`（2026-10-03 第三次交付）。

## 当前状态

- 2026-10-11 建立。开发者决定：品牌资产可以进仓库；看板娘放进空态卡与继续写作卡；字体按 Fraunces（拉丁）+ 系统宋体栈（中文）。
- 2026-10-11 S3：服务端。宿主能力 `userDirectoriesKey`（主目录与系统文档目录，`src/server/user-directories.ts`）；目录校验认 `~`；新建作品的父目录不存在就建、先排除状态根；作品信息多 `cover`；远程合同升到版本 3：`library()`、`browse()`、`create` 不再有 `no-library`，`ShelfItem.cover`；封面经 `http.routes` 的 `GET/PUT/DELETE /api/nbook.projects/cover/<id>`。Spec `runtime/projects.md` 第 1、13、14、18 条改写，新增 19 到 21 条。验证：三组 typecheck；`bun test` 项目相关 83 例（新增 `user-directories.test.ts`、`cover-routes.test.ts`，`identity.test.ts`、`projects.test.ts` 各加一组）；`docs:check`、`governance:check` 无失败。
- 2026-10-11 S2：通知。nb-ui `createNotificationQueue()`、`Notification` 进度、`NotificationViewport` 的 `queue`（去掉 Nuxt 的 `ClientOnly`）、新 `Banner`，子路径 `@notnotype/nb-ui/notifications`；工作台 `notificationsKey` 服务与页面根上的视口（`WorkbenchNotifications`）；Spec `workbench/notifications.md`。Lab 工具条去 `overflow: hidden`，`lab:shot` 机检聚焦光晕裁切（`measure().clippedFocus`）。验证：nb-ui 与 neuro-book typecheck；nb-ui 124 例、neuro-book 相关 DOM 测试与 bun 测试通过；Lab 截图 `Banner`、`Notification`、`NotificationViewport` 无溢出无裁切。设计稿：[cards](evidences/draft5-cards.png)、[list](evidences/draft5-list.png)、[empty](evidences/draft5-empty.png)、[create](evidences/draft5-create.png)、[add](evidences/draft5-add.png)；裁切现象 [lab-select-glow-clipped.png](evidences/lab-select-glow-clipped.png)。
- 2026-10-11 S0、S1：品牌资产进仓库（`packages/neuro-book/src/ui/brand/`、`src/web/public/`、nbook 主题的 `assets/fonts/`）；字体栈；标题栏字标、`ShelfEmptyState`、继续写作卡与新建对话框的“位置”行先做成 Lab 静态稿给开发者看：[空书架](evidences/s1-empty-light.png)、[手机](evidences/s1-empty-phone-light.png)、[书脊视图](evidences/s1-spines-light.png)、[新建对话框](evidences/s1-create-dialog-light.png)、[继续写作卡（深色）](evidences/s1-continue-dark.png)。验证：typecheck；组件测试 16 例（新增 `ShelfEmptyState.dom.test.ts`、`ProjectInfoDialog.dom.test.ts`）；Lab 截图无溢出无报错；`docs:check`、`governance:check` 无失败。开发者看过后提出重做，见上。
