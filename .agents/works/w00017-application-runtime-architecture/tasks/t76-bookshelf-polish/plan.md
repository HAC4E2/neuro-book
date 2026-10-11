# t76 实施计划：书架打磨一

## Context

- **为什么做**：开发者 2026-10-11 看了新应用，书架、工作台、文件树都不如旧应用完善，要求逐页打磨，先书架。S0、S1（品牌成品、字体、第一版静态稿）之后开发者看稿提出六点（第一屏没有设计感且空旷、两个入口看不懂、路径输入是命令面板、表单与错误落点、下拉光晕被裁、通知没有去处），经五轮静态稿（`evidences/draft5-*.png`）定下本计划的设计。
- **开发者的决定**（2026-10-11）：
  - 通知按“谁能对它做什么”分三个去处：能当场改的输入在字段下；操作结果与后台失败走右下角通知（可带动作、进度，错误与带动作的不自动消失）；整页或整视图不可用原位阻断。通知形式补足到 nb-ui 与应用的通用组件；过时的组件清理掉。
  - 第一屏不用拟真书架：卡片与列表两种视图；永远不用左侧色条这类“贴色”表达归属。案头是统计、最近写到与看板娘，不再有“继续写作”大卡。作品要有封面。
  - 标题栏去掉“用户资产”，右侧是设置菜单和预留的头像（不可点）。看板娘在案头右端，眼睛跟鼠标。
  - “加入已有目录”改名“打开已有作品”，用通用的文件/目录选择器（可拖动的 `DialogWindow`）；新建作品也用 `DialogWindow`，提示进 tooltip，表单保持简洁。
  - 空书架与有作品同一副骨架：案头放问候与看板娘，网格里是两张“待写的书”。
  - 作品目录缺省为系统文档目录下的 `NeuroBook`（解析不到时 `~/NeuroBook`），不存在就建；路径认 `~`。
  - 封面文件放作品文件夹根下的 `cover.<ext>`，随文件夹走。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation`，每片自跑验证后单独提交；测试用真实内核、真实目录与真实浏览器，不用 mock；omp 审查在 Task 收口时做，非阻塞。

## 关键设计

### 通知（`packages/nb-ui/src/`、`src/plugins/workbench/`）

- **nb-ui**：
  - `composables/useNotification.ts`：队列可实例化。`createNotificationQueue()` 返回 `{notifications, notify, update, remove, clearAll, pause, resume, success, warning, error, info}`；`useNotification()` 仍返回模块级的缺省队列（兼容现有调用）。`notify` 多 `progress?: number | null`（0 到 100，null 为不确定进度）；`update(id, patch)` 改标题、正文、色调、进度与动作；`duration: 0` 常驻。
  - `feedback/Notification.vue`：多 `progress` 与 `indeterminate`，用 `Progress` 画在正文下；其余不变。
  - `feedback/NotificationViewport.vue`：去掉 Nuxt 的 `<ClientOnly>`（新应用解析不到），改用 `onMounted` 标记；多 `queue?: NotificationQueue`，缺省取 `useNotification()`。有了 `queue` 这个 prop，Lab 可以给它局部队列挂载，标签从 `state:shared-*` 去掉。
  - `feedback/Banner.vue`（新）：区域或页面顶部的常驻横幅：`tone`、`title?`、`message`、`actionLabel?`、`dismissible`；平铺、无投影、满宽；`role` 按色调取 `status` 或 `alert`。
  - `components/index.ts`、`README.md`、Lab 夹具（`fixtures/nb-ui/feedback.ts`）登记 `Banner` 与 `NotificationViewport` 的场景，`Notification` 加进度场景。
- **`nbook.workbench`**：
  - `shared/contracts.ts`：服务键 `notificationsKey`（`nbook.workbench/notifications`）与合同 `Notifications {notify(input): NotificationHandle}`、`NotificationInput {tone, title?, message, action?: {label, run}, progress?, sticky?}`、`NotificationHandle {id, update(patch), dismiss()}`。文字是已按当前语言写好的字符串（调用方负责）。
  - `web/notifications.ts`：`createNotifications()` 持有一份 `createNotificationQueue()` 的队列；`sticky` 与 `action` 或 `tone: "error"` 一律 `duration: 0`，否则按 nb-ui 的缺省时长。
  - `web/plugin.ts`：`provides` 加 `notificationsKey`；两个内置页面的根（`home-page.ts` 的渲染）多挂一个 `NotificationViewport`（`position: "bottom-right"`，传入这份队列）。
  - Lab 不挂产品视口；Lab 场景要通知时用自己的局部队列。
- **书架**：`BookshelfPage` 顶部的提示条与 `ProjectInfoDialog` 的红字删除；`shelf-page.ts` 的 `notice` 改为经 `host.notifications` 发出（刷新失败带“重试”动作、常驻，恢复后 `dismiss`）。

### 服务端（`src/server/projects/`、`src/plugins/projects/backend/`、`shared/contracts.ts`）

- **缺省作品目录**：`library.ts`（新）：`resolveDefaultLibrary(env, platform)`：Windows `%USERPROFILE%\Documents`，macOS `~/Documents`，Linux 依次 `xdg-user-dir DOCUMENTS`、`~/.config/user-dirs.dirs` 的 `XDG_DOCUMENTS_DIR`、存在的 `~/Documents`；都解析不到时 `~/NeuroBook`。只在设置为空时用。远程合同加只读方法 `library() → {path, source: "setting" | "default"}`。
- **建目录与 `~`**：`expandHome(path, home)` 把开头的 `~` 与 `~/` 换成主目录，用在 `create.parent`、`register.path`、`browse.path` 与设置里的作品目录；`create` 对父目录 `mkdir -p` 后再 `checkProjectDirectory`，建不出来按 `invalid-parent`，详情带解析后的路径与原因。
- **`browse({path?})`**（只读）：列出一个目录下的子目录：`{path, parent: string | null, entries: [{name, path, kind: "project" | "registered" | "directory", title?: string}]}`；`path` 省略为作品目录；`project` 指有 `.nbook/project.json` 的目录（读出书名），`registered` 指已在登记表里；只列目录，不列文件；读不到按 `invalid-parent`。
- **封面**：身份文件可带 `cover`（作品目录内的相对路径，规则沿用旧应用 `normalizeProjectCoverPath`：不指向 `.nbook`、`.git`、绝对路径或上级目录，扩展名 png、jpg、jpeg、webp）。服务端入口向 `http.routes` 贡献 Hono 应用：`GET /cover/<id>` 返回文件（`Cache-Control: private, max-age=0, must-revalidate` 加 `ETag` 取修改时间）；`PUT /cover/<id>`（`multipart/form-data`，字段 `file`，至多 5 MB，按内容嗅探格式）写到 `cover.<ext>` 并更新身份文件；`DELETE /cover/<id>` 删文件并清字段。`ShelfItem` 多 `cover: {version: string} | null`（修改时间），页面拼 `/api/nbook.projects/cover/<id>?v=<version>`。
- **统计**：不改；“最近写到”由页面按各作品的 `stats.last` 排序取前三条。
- Spec `runtime/projects.md`：第 13 条加 `cover`，第 14 条缺省目录、建目录与 `~`，新增 `library`、`browse` 与封面路由条目；远程合同版本升到 3。

### 选择器与对话框（`packages/nb-ui/src/components/navigation/`、`src/plugins/projects/web/components/`）

- **nb-ui `FileBrowser`**（新，纯展示）：props `path`（面包屑段）、`entries: [{id, name, kind: "directory" | "file", badge?: string, iconClass?, selectable?}]`、`selectedId`、`loading`、`error`、`emptyText`；emits `navigate(segmentIndex | entryId)`、`update:selectedId`、`activate(entryId)`（双击或回车进入）、`request-path`（键盘输入路径入口）、`create-folder`。键盘：上下、Home、End、Enter、Backspace 返回上一级。消费 `Breadcrumb` 与 `.nb-ui-popover-item` 的圆角，自己不取数据。
- **产品 `PathPickerDialog.vue`**（`src/plugins/projects/web/components/`）：`DialogWindow` 包 `FileBrowser`，接一个 `source: {list(path: string | null): Promise<BrowseResult>}`（本期是远程 `browse`），prop `mode: "project" | "directory"`（选作品或选目录），底部一行“已选 …”与确认按钮；输入路径走一个内联 `FormInput`（回车跳转）。“打开已有作品”“更改作品目录”都用它。
- **`ProjectInfoWindow.vue`**（替换 `ProjectInfoDialog`）：`DialogWindow`（`size` 自定 700 宽、`resizable: false`）。左封面位（有图显示图，没图用 `BookCover` 排版封面；“上传封面…”经 `<input type="file">`，ⓘ 的 tooltip 说明规则）；右字段：书名、简介（字数到上限八成才显示计数）、主题色（“自动”加八档色板加“自定义…”打开 `ColorPicker`）、放在哪里（只在新建时：作品目录输入框、由书名生成的文件夹名作为后缀显示、“浏览…”开 `PathPickerDialog`，ⓘ 说明“目录不存在会一并创建”）。字段级错误（服务端 `invalid-metadata` 与 `invalid-parent`）显示在对应字段下；其它失败走通知。tooltip 用 nb-ui `Tooltip`（portal，不被窗口裁切）。
- **`shelf-page.ts`**：`createTarget()` 改为 `library()`：读远程 `library()`，对话框带着它打开，不再先问路径；`create` 多传 `parent`（用户改过时）与成功后 `setCover`；`addExisting(path)` 收选择器的结果再登记；`changeLibrary(path)` 写设置。

### 书架页（`src/plugins/projects/web/components/`）

- **标题栏**：左边标志加字标加“· 书房”；右边 `Dropdown`“设置”（项：切换主题、明暗、界面语言、作品目录…；前三项经命令服务执行现有命令，最后一项开目录选择器）与头像位（`Avatar`，不可交互，`title` 写“个人资料尚未开放”）。
- **案头 `ShelfDesk.vue`**（新，替换 `ContinueCard`）：左统计（今天字数大字、总字数、篇数、作品数；“继续写作《书名》”按钮指向继续写作的目标），中“最近写到”（各作品 `stats.last` 按时间取前三：书名、片段名、摘录一行、时间；点一条发 `continue(id)`），右 `NeuroBookMood`（`idle`，150px）。不给面。没有任何编辑记录时只有统计与看板娘；空书架时左边换成问候（标题与一句说明）。
- **封面 `BookCover.vue`**（新）：2:3；有 `src` 画图，没有按主题色（`spineHue` 的色档或作者给的颜色）与书名排一张（书名按长度分档字号，浅色底用深字）；尺寸由使用方给。
- **卡片 `BookCard.vue`**（新）：封面在左（84px），右边书名（宋体）、两行简介、底部字数篇数与最近编辑（`stale` 写“统计于某时”）；正在打开的作品一个绿点加“已打开”；悬停才出“更多”（`Dropdown`：在新窗口打开、编辑信息、从书架移除）；选中用焦点环。网格 3 列，窄于 960px 两列，窄于 640px 一列。键盘：网格是 `listbox`，方向键移动，Enter 打开，Delete 请求移除（沿用原书脊的键盘合同）。
- **列表 `ShelfList.vue`**（改）：行首 30px 封面；其余列不变。
- **空态**：同一骨架；网格里两张 `BookCard` 形态的“待写的书”（`ShelfEmptyCards.vue`，替换 `ShelfEmptyState`）。
- **删除**：`SpineShelf`、`BookSpine`、`ShelfTitlePage`、`ShelfEmptyState`、`ContinueCard` 及其 `.md`、测试与 Lab 场景；`shelf-format.ts` 里只给书脊用的高度与厚度函数一并删，色档函数保留给封面。
- **Lab**：`BookshelfPage` 场景改为 cards、list、empty、english 与窄屏；新增 `BookCard`、`BookCover`、`ShelfDesk`、`PathPickerDialog`、`ProjectInfoWindow` 的夹具与场景；`lab:shot` 截图无溢出。

### Lab 光晕裁切（`src/plugins/lab/web/lab-shell.css`、`scripts/lab-shot.ts`）

- `.lab-bar` 与 `.lab-bar--tight` 去掉 `overflow: hidden`，横向不滚动由 `flex-wrap` 与容器查询承担（原注释的目的保留）；控件上下留出不小于 8px 的内距。
- `lab:shot` 多一项检查：对舞台里每个可聚焦控件逐个聚焦，读它的 `box-shadow` 外扩量，与所有 `overflow` 不为 visible 的祖先的内容盒比较，光晕越界就记成问题（与溢出检查同一输出）。

## Spec 与文档改动

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/notifications.md`（新） | 通知的三个去处、服务合同、视口位置与时长、Lab 与产品的挂载规则；验收 |
| `docs/specs/workbench/bookshelf.md` | 输出 1 到 8 改写为标题栏、案头、卡片与列表、空态；输出 11、12 改为两个窗口与选择器；失败与恢复表按三个去处；验收与 Smoke 改写 |
| `docs/specs/runtime/projects.md` | 第 13 条 `cover`；第 14 条缺省目录、建目录、`~`；新增 `library`、`browse`、封面路由；合同版本 3 |
| `docs/specs/ui/workbench-shell.md` | 输出 36、37：首页根挂通知视口；“书架页上有进入工作台的入口”删除 |
| `docs/specs/README.md` | 注册表加通知一行；书架页说明改写 |
| `docs/proposals/bookshelf.md` | 决策记录加 2026-10-11：书脊换卡片、加封面、案头、通知去处 |
| `packages/nb-ui/docs/design-language.md` | 加一条：卡片不用左侧色条、顶部色带这类“贴色”表达归属 |
| `packages/nb-ui/docs/ui-development-spec.md` | 自检清单“外扩阴影防裁切”补“工具条不设 overflow hidden，光晕裁切由 `lab:shot` 机检” |
| `packages/nb-ui/README.md` | 登记 `Banner`、`FileBrowser` |
| 组件同名 `.md` | 新增与修改的每个组件 |

## 切片

| 片 | 内容 | 验证 |
|---|---|---|
| S0、S1 | 已完成（品牌、字体、第一版静态稿），见 README |  |
| S2 | 通知：nb-ui 队列可实例化、`Banner`、进度、视口去 Nuxt；工作台通知服务与视口；Spec；Lab 工具条光晕修复与 `lab:shot` 机检 | nb-ui `test`、`typecheck`；neuro-book `typecheck`、工作台与 Lab 的受影响测试；`lab:shot` 跑 `Notification`、`Banner`、`NotificationViewport` |
| S3 | 服务端：缺省作品目录、建目录、`~`、`library`、`browse`、封面；Spec | `projects.test.ts`、`identity.test.ts`、`server-projects.test.ts`、新 `cover.test.ts`（真实 HTTP） |
| S4 | nb-ui `FileBrowser`；`PathPickerDialog`、`ProjectInfoWindow`；`shelf-page.ts` 流程改接；通知替换提示条 | `FileBrowser.test.ts`、两个窗口的 `.dom.test.ts`、`shelf-page.test.ts` |
| S5 | 书架页重排：标题栏、案头、封面、卡片、列表、空态；删除书脊组件；Lab 场景与截图；e2e；Spec 与提案 | 组件 `.dom.test.ts`、`lab:shot`、`bookshelf.e2e.ts`、`bookshelf-stats.e2e.ts` |
| S6 | 收口：`test:affected --typecheck`、全量 e2e、`docs:check`、`governance:check`、omp 审查（非阻塞）、README、回写建议 |  |

## 验收映射

| 行为 | 测试 |
|---|---|
| 通知服务：发出、更新进度、常驻与自动消失、动作执行后移除、视口挂在两个页面根上 | `notifications.test.ts`（真实内核与工作台插件）、`NotificationViewport` 组件测试 |
| 缺省作品目录三平台解析、`~` 展开、建目录、建不出来的详情 | `library.test.ts`、`identity.test.ts`、`projects.test.ts` |
| `browse` 标出作品与已登记目录、只列目录、读不到的目录 | `projects.test.ts` |
| 封面上传、读取、删除、超限与格式拒绝、身份文件字段 | `cover.test.ts`（真实 HTTP 服务端） |
| 新建不再先问路径；位置可改并写设置；打开已有作品经选择器；错误落在字段或通知 | `shelf-page.test.ts`、`ProjectInfoWindow.dom.test.ts` |
| 卡片网格键盘、更多菜单、列表封面、空态两张卡 | `BookCard.dom.test.ts`、`BookshelfPage.dom.test.ts` |
| 真浏览器：空书架到新建第一部作品（含封面）、打开已有作品、继续写作 | `bookshelf.e2e.ts`、`bookshelf-stats.e2e.ts` |
| Lab 工具条聚焦光晕不被裁 | `lab:shot` 机检对 `LabShell` 的工具条 |

## 验证

- 每片：对应包的 `typecheck` 与受影响测试；涉及 UI 的片跑 `lab:shot`，四主题里 nbook 明暗各一次。
- 收口：`bun run test:affected --typecheck`、`docs:check`、`governance:check`、全量 e2e（先 `build:server`、`build:web`、`build:e2e`）。
- 未验证的边界：Windows 与 macOS 的文档目录解析只有单元测试（按注入的环境变量与平台），没有真机；桌面壳的原生目录对话框不在本期。

## 不做与风险

- 不做：通知中心、活动栏角标、系统通知、连接状态横幅（`Banner` 组件先进库，第一个使用者在后续 Task）；品牌色进主题；个人资料。
- 风险：`FileBrowser` 列目录的来源只有 `nbook.projects` 的 `browse`，以后别的插件要选文件需要 `nbook.files` 提供来源，本期不做。
- 风险：封面经 HTTP 而非 RPC，浏览器宿主的来源核对对 `/api/` 已有规则（同源），无需额外处理；上传大小与格式在服务端判。
- 风险：删除书脊组件会让 `bookshelf.e2e.ts` 大改，随 S5 一起改。
