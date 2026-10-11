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
- 2026-10-11 omp 实现审查（`a60eb885..e08b2508`，[报告](evidences/implementation-review.md)）：11 条，重要 9、建议 2、阻断 0。逐条核实后的处理：
  - C1 通知动作抛错：工作台服务接住错误、记诊断 `workbench.notifications`；nb-ui 视口也改为抛错照样移除，错误交给 Vue 的错误处理（新增 `NotificationViewport.test.ts`）。
  - C2 只改色调就丢了明确给的 `sticky`：服务记住调用方明确给的值，直到再次明确改它。
  - C3 悬停中 `update` 改时长会重新挂计时器：队列单独记暂停状态，暂停中只记到期时间。
  - C4 作品目录没读到时选择器发空路径：模型把空白路径当省略，宿主改传 `null`。
  - C5 链接目录交出链接路径：条目交真实路径，解析不了的不列；`runtime/projects.md` 第 20 条写明。
  - C6 身份文件读取无大小上限：不改。身份文件由 NeuroBook 写，不到 1 KB；读的是用户本机自己的目录；加上限要新增一种失败（两份 Spec、诊断与界面），收益小。留给开发者定。
  - C7 封面写入失败删掉旧文件：触发条件比报告说的窄。同格式重传时身份文件本来就记着 `cover.png`，更新是空操作、不写盘；会丢文件的是目录里已有一张身份文件没记的 `cover.png`。改为先把同名文件挪进 `.nbook/`，失败时还原；第 21 条写明。
  - C8 先解析完整个请求体才判大小：改用 `hono/body-limit` 在接收时限长（5 MB 加 64 KiB 表单开销）；第 21 条写明。
  - C9 面包屑重名时跳错目录：按位置取段。
  - C10 Lab 光晕检查把不可聚焦外框上直接写的 `:focus-visible` 也算进来：选择器判定抽到 `focus-rules.ts`，只看含焦点伪类的分支；焦点伪类直接写在元素上时它自己得能聚焦；转义的冒号不算伪类。`ui/component-lab.md` 补上 S2 漏写的光晕检查说明与验收 25，`lab-shot.e2e.ts` 加真实浏览器用例。
  - C11 测试缺口：上面每条成立的缺陷都在暴露缺口的测试里补了回归。装真实工作台插件的入口级测试没有补，和通知 Spec 的验收 2 一起留给开发者定：产品里目前没有从 `/` 站内导航到 `/workbench` 的入口，这条验收在真实浏览器里走不到。
  - 变异检查 13 个全杀（其中“视口抛错不移除”起初存活：工作台的包装接住了错误，视口测不到，补了 nb-ui 视口自己的测试后杀掉）。验证：`test:affected --typecheck --since a60eb885` 除既有的 `settings/commands.test.ts` 一例外全过（nb-ui 530 例，neuro-book `bun test` 982 过、vitest 161 例）；全量 e2e 157 例；`docs:check`、`governance:check` 无失败无警告。
- 2026-10-11 S6：收口。`test:affected --typecheck --since a60eb885`：nb-ui typecheck 与 31 个文件 528 例；neuro-book typecheck、`bun test` 977 过 1 败、vitest 38 个文件 160 例。失败的是 `settings/commands.test.ts` 的切换主题一例，在 t76 起点 `a60eb885` 上同样失败，是既有问题。全量 e2e 156 例（改样式前后各一次）；`docs:check`、`governance:check` 无失败无警告。收口时的修正：nb-ui 的 `dist/nb-ui.css` 自 t73 后没有重建，S2 到 S5 新加的类都不在产物里；应用的 UnoCSS 替 nb-ui 组件补出了大部分工具类，把这件事掩盖了，补不出的是 `bg-[var(--…)]` 这类，于是应用里 `FileBrowser` 没有输入框底色、通知的不确定进度短条没有颜色、`Dropdown` 的 `wrap` 没有最大宽度；已重建产物并更新截图（[FileBrowser（深色）](evidences/s4-file-browser-dark.png)、[目录选择器](evidences/s5-path-picker-light.png)、[不确定进度（深色）](evidences/s6-notification-indeterminate-dark.png)）。不确定进度短条原先在组件里写死 `1.4s`（nb-ui 的 token 扫描拦下），改为基座类 `nb-ui-indeterminate-runner`。nb-ui 的 vitest 补上 `--no-experimental-webstorage`：Node 26 的全局 localStorage 盖住了 happy-dom 的，colorway 5 例因此失败（与本 Task 无关的既有问题，参数与 neuro-book 一致）。`ui-development-spec.md` 自检清单按新的光晕检查判据改写，文中 8 处 `§` 改成小节名；计划的验收映射按实际的测试文件改写。
- 2026-10-11 S4、S5：界面。nb-ui 新 `FileBrowser`（键盘焦点环画在外框上）；作品里的 `PathPickerDialog`（打开已有作品、选作品目录，可移动的 `DialogWindow`）与 `ProjectInfoWindow`（新建与修改信息合一，带封面、色板、ⓘ 提示，字数接近上限才显示计数）；书架页重排为案头（`ShelfDesk`：统计、最近写到、看板娘，窄时两列）加卡片（`ShelfCards`、`BookCard`、`BookCover`）或列表，空书架是同一骨架里的两张待写卡；失败交工作台通知。删除书脊、标题页、继续写作卡、旧空态与旧对话框。Lab 的聚焦光晕检查改为从样式表的焦点规则找会画环的元素（原先把所有可聚焦元素都算上，误报）。途中的坑：nb-ui `FormField` 的根是 `<label>`，点里面任何地方都转给第一个可标注的控件，色板行不能放进去；`FormSelect` 是多根组件，scoped 宽度类落不到触发器上，宽度给外框；`FormInput` 有前后缀时根是外框、没有时根就是 `<input>`，测试选择器两种都写，聚焦按 id；容器查询只作用于后代，网格要放在容器里面一层；`focusShelf` 的单条选择器列表按文档顺序取第一个，重排后总落到工具栏的“新建作品”。验证：三组 typecheck；组件 DOM 测试 17 个文件 60 例（新增 `BookshelfPage.dom.test.ts`，变异检查拦住选择器顺序回退）；`bun test` 项目、Lab、工作台 289 例；nb-ui `FileBrowser` 4 例；e2e `bookshelf.e2e.ts`、`bookshelf-stats.e2e.ts` 5 例，`lab.e2e.ts`、`lab-shot.e2e.ts`、`commands.e2e.ts` 18 例；`lab:shot` 书架页（卡片、列表、空、英文，明暗，1280、1600、390）、案头、两个窗口、`FileBrowser` 全部 0 溢出、0 光晕裁切。截图：[卡片](evidences/s5-cards-light.png)、[卡片（深色）](evidences/s5-cards-dark.png)、[列表](evidences/s5-list-light.png)、[空书架](evidences/s5-empty-light.png)、[手机](evidences/s5-cards-phone-light.png)、[新建作品窗口](evidences/s5-create-window-light.png)、[目录选择器](evidences/s5-path-picker-light.png)、[FileBrowser（深色）](evidences/s4-file-browser-dark.png)。
- 2026-10-11 S3：服务端。宿主能力 `userDirectoriesKey`（主目录与系统文档目录，`src/server/user-directories.ts`）；目录校验认 `~`；新建作品的父目录不存在就建、先排除状态根；作品信息多 `cover`；远程合同升到版本 3：`library()`、`browse()`、`create` 不再有 `no-library`，`ShelfItem.cover`；封面经 `http.routes` 的 `GET/PUT/DELETE /api/nbook.projects/cover/<id>`。Spec `runtime/projects.md` 第 1、13、14、18 条改写，新增 19 到 21 条。验证：三组 typecheck；`bun test` 项目相关 83 例（新增 `user-directories.test.ts`、`cover-routes.test.ts`，`identity.test.ts`、`projects.test.ts` 各加一组）；`docs:check`、`governance:check` 无失败。
- 2026-10-11 S2：通知。nb-ui `createNotificationQueue()`、`Notification` 进度、`NotificationViewport` 的 `queue`（去掉 Nuxt 的 `ClientOnly`）、新 `Banner`，子路径 `@notnotype/nb-ui/notifications`；工作台 `notificationsKey` 服务与页面根上的视口（`WorkbenchNotifications`）；Spec `workbench/notifications.md`。Lab 工具条去 `overflow: hidden`，`lab:shot` 机检聚焦光晕裁切（`measure().clippedFocus`）。验证：nb-ui 与 neuro-book typecheck；nb-ui 124 例、neuro-book 相关 DOM 测试与 bun 测试通过；Lab 截图 `Banner`、`Notification`、`NotificationViewport` 无溢出无裁切。设计稿：[cards](evidences/draft5-cards.png)、[list](evidences/draft5-list.png)、[empty](evidences/draft5-empty.png)、[create](evidences/draft5-create.png)、[add](evidences/draft5-add.png)；裁切现象 [lab-select-glow-clipped.png](evidences/lab-select-glow-clipped.png)。
- 2026-10-11 S0、S1：品牌资产进仓库（`packages/neuro-book/src/ui/brand/`、`src/web/public/`、nbook 主题的 `assets/fonts/`）；字体栈；标题栏字标、`ShelfEmptyState`、继续写作卡与新建对话框的“位置”行先做成 Lab 静态稿给开发者看：[空书架](evidences/s1-empty-light.png)、[手机](evidences/s1-empty-phone-light.png)、[书脊视图](evidences/s1-spines-light.png)、[新建对话框](evidences/s1-create-dialog-light.png)、[继续写作卡（深色）](evidences/s1-continue-dark.png)。验证：typecheck；组件测试 16 例（新增 `ShelfEmptyState.dom.test.ts`、`ProjectInfoDialog.dom.test.ts`）；Lab 截图无溢出无报错；`docs:check`、`governance:check` 无失败。开发者看过后提出重做，见上。
