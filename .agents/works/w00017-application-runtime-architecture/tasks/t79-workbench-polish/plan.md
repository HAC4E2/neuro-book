# t79 实施计划：工作台打磨——打开项目之后的那一页

## Context

- **为什么做**：工作台的外壳、资源管理器与编辑器功能齐了，但“打开项目之后的那一页”没有走过注意力排序与静态稿。开发者 2026-10-12 逐轮看过现状截图与四轮静态稿，确认了 12 条决定（[README](README.md) 当前状态一节逐条记着）。终稿：[合在一起](evidences/draft3-final.png)、[线条精简](evidences/draft4-lines.png)（取 L1）、[深色](evidences/draft4-dark.png)、[欢迎页](evidences/draft3-welcome.png)。
- **已确认的决定**（编号同 README）：
  1. 打开作品回到上次写的地方；空作品给“新建”入口。
  2. 不碰章节结构；资源管理器照现行合同显示文件名。
  3. 没有视图的右侧栏与底部面板默认隐藏。
  4. 只做桌面宽度。
  5. 编辑区纸面：去掉灰底，与面板同色；正文界面字体 17px、行距约 1.95、版心 720px。
  6. （被 10 改判）
  7. 资源管理器的工具按钮并进标题行（24px），去掉浮条；根节点显示书名。
  8. 外壳平铺：底色统一，侧栏贴边用分隔线。
  9. 加载过渡：米色底、居中书名加细进度条。
  10. 空态与欢迎页分开：空编辑区只有一句提示；欢迎页是编辑区里的标签，新作品第一次打开时自动打开，平时从“帮助”菜单或命令打开，内容是作品概况、新建与最近打开、入门提示、快捷入口。
  11. 线条只留三条：标题栏底线、侧栏与编辑区之间一条竖分隔、状态栏顶线；标签栏不画线，当前标签加粗。
  12. 文件树：选中只用浅底、不描边；行带圆角；展开收起有动画。
- **已有的、不用重做的**：编辑器按 `editor.session` 记录恢复上次的标签与活动项（[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 5）；书架“继续写作”打开地址并把光标放到文末（输出 29）。
- **工作方式**：t78 完成后开工（头部图标按钮的 24px 档、内嵌焦点线由 t78 提供）。主 Agent 编码，worktree `.worktree/w00017-runtime-foundation`，每片自跑验证后单独提交；测试用真实内核、Storage、Files 与 Chrome，不用 mock 与假计时器。

## 关键设计

### 1. 书名进窗口（`src/server/projects/`、`src/shared/projects.ts`、`plugins/projects/shared/shelf.ts`）

- 显示名的规则改为“书名，没有书名时用目录的原名”。短名（`registry.ts` 的目录名转写，给 `?project=` 用）不再出现在界面上。`projectDisplayName` 的缺省从 `name` 改为目录原名；书架卡片、目录选择器随之改。
- 窗口绑定结果里的项目加 `title`（按上面的规则算好的显示名），`windowProjectKey` 带出去。标题栏、状态栏、资源管理器根节点用它；`data-workbench-project` 仍是短名（地址与测试用）。

### 2. 加载页（`src/web/index.html`、`HostPage.vue`、`src/shared/browser-bootstrap.ts`）

- 引导响应在地址带 `?project=` 时附上这部作品的显示名（服务端查登记表，查不到时不带）。引导是窗口的第一个请求，书名几十毫秒内就到。
- `index.html` 的内联样式直接画米色底与一条不确定进度条，不放文字，位置固定在中间，不再从左上角跳到中间；引导回来后在进度条上方补上书名，宿主页（连接中、失败页）沿用同一个底色与位置。
- 底色在应用起来之前按系统明暗（`prefers-color-scheme`）取，应用起来后按产品设置；设置与系统不一致的人会看到一次底色切换，接受。

### 3. 外壳：平铺、线条与默认显隐（`plugins/workbench/web/components/`、`state/layout-store.ts`）

- **平铺**：活动栏、工具区（侧栏、右侧栏）、面板去掉圆角、外边距与外框，外壳底色用面板底色；部件之间只用外壳网格本来的分隔条作竖线或横线。标题栏底线、状态栏顶线保留；工具区标题行、编辑器标签栏不画线，当前标签加粗（标签宽度按加粗预留，切换时不跳）。右栏与面板的容器标签带用 nb-ui `Tabs` 新增的 `baseline: false` 去掉底边线。
- **默认显隐**：右侧栏与底部面板“空着”（现在没有容器，也没有视图把它声明为默认位置）、用户也没主动打开过时不显示；标题栏开关与命令打开它时记为“用户打开过”，之后照现有的 `hiddenParts` 规则；有插件把视图放进去后按视图的默认位置出现。只看现在的容器会让拖空的区域当场消失、不再是落点（外壳 Spec 输出 20），所以声明也算。规则写进外壳 Spec。
- **右缘竖条**：页面根上 `scrollbar-gutter: stable both-edges` 在不滚动的工作台页留出约 10px 的空条；工作台页根不预留滚动条位置。

### 4. 编辑区（`plugins/editor/web/components/`、`session-record.ts`）

- **纸面**：编辑组底色改用面板底色；Markdown 正文版心 720px、上下留白 64px、17px、行距约 1.95、段距 1.1em，数值做成 Markdown 控件自己的变量。源码编辑器不变。
- **空态**：没有标签时只显示一句居中的淡色提示“在左边的资源管理器里打开一个文件”。
- **光标位置**：会话记录的每个标签加可选的光标（Markdown 存文档内位置，源码存行列），光标停下 1 秒、失焦与换文档时记下；恢复标签时按记录放回光标，内容变短越界时夹到末尾；恢复会话时活动标签就绪后聚焦一次（与继续写作同一套取消规则）。光标是可选字段，旧记录照样合法，记录版本不变（版本加一会让 Storage 把旧记录判为不支持的版本、会话整个丢掉）。
- **最近打开**：编辑器另存一份按作品的最近打开列表（project/local 记录，至多 10 个地址），打开文件时更新，供欢迎页用。

### 5. 资源管理器（`plugins/workbench/shared/views.ts`、`plugins/explorer/web/`）

- **视图标题动作**：外壳 Spec 里“视图标题动作的贡献，随第一个消费者”在本 Task 实现。视图声明里可以带动作（命令 id、图标、标题、`when`），外壳在视图标题行（single 时在容器标题行）右侧画成 24px 图标按钮；资源管理器把现有五个按钮（新建文件、新建文件夹、刷新、全部收起、显示清单文件）改成声明的动作，删掉自己画的浮条。
- **根节点**：项目根显示书名（第 1 节的显示名），用户资产根不变。
- **行样式**：选中只用强调色浅底与强调色文字，不描边；悬停与选中的底色是圆角块（左右各留 6px）。键盘焦点照 t78 的内嵌焦点线。
- **展开收起动画**：树是虚拟列表，不能像旧树那样给整棵子树做高度动画；改为新出现的行淡入并从上方滑下一行高、下面的行随位移过渡，收起反向，时长取主题的 `--motion-base`；系统设了减少动画时不动。
- **揭示当前文件**：打开作品、编辑器恢复出活动标签后，资源管理器展开到它所在目录、选中并滚到可见处；之后切换标签不自动揭示（避免树跟着乱跳）。（实施时发现并没有现成的手动揭示命令，本 Task 不新增。）活动标签经编辑器新的公开键 `nbook.editor/ready`、`nbook.editor/activeDocument` 交给资源管理器。

### 6. 欢迎页（`plugins/editor/web/`、`plugins/projects/web/`）

- **页面标签**：编辑区支持一种不对应文件的“页面”标签：由贡献点 `editor.pages` 登记（id、标题、组件），按 id 打开，同一页面只开一个；不写入会话记录，刷新后不恢复。
- **欢迎页由 `nbook.projects` 贡献**（作品信息、统计与回书架都归它）：
  - 作品概况：书名、简介、字数与篇数（书架的统计服务）；
  - 开始：“新建章节”（在项目根新建 Markdown 文件并打开）、快捷入口、“回到书架”；
  - 最近打开：编辑器的最近打开列表，至多 5 个；
  - 入门：三条固定提示。
- **快捷入口**：项目根下名字以“大纲”“设定”开头的文件或文件夹，有几个显示几个，点了打开文件或在资源管理器里揭示文件夹。
- **自动打开**：作品第一次打开（这部作品还没有 `editor.session` 记录）时打开欢迎页；“帮助”菜单加“欢迎”，命令面板可搜到。
- **实施中的修订**（S5）：
  - 页面标签的地址是 `page://<id>`，按 id 由命令 `nbook.editor.open-page` 打开；`nbook.editor.open` 拒绝这类地址，页面标签不能拆分、不能换编辑器。
  - “帮助 > 欢迎”的命令 id 是 `nbook.help.welcome`：内置命令的 domain 清单里没有 `projects`。
  - 资源管理器没有揭示命令（S4 已记），为快捷入口新增 `nbook.files.reveal`（地址与可选的 `expand`，只给 Agent 与代码调用，不进命令面板）。
  - `nbook.projects` 对文件服务的依赖是可选的：没有文件插件时没有快捷入口，“新建章节”说明原因。
  - “第一次打开”看会话记录的读取结果是“没有”；从书架“继续写作”进来时不打开。

## Spec 与文档改动

| 文档 | 改什么 |
|---|---|
| `docs/specs/runtime/projects.md` | 显示名规则（书名，没有时用目录原名）；绑定结果带显示名 |
| `docs/specs/runtime/browser-host.md` | 引导带作品显示名；加载页的样子与位置不跳 |
| `docs/specs/ui/workbench-shell.md` | 平铺外观与三条线；空的右侧栏与面板默认隐藏的规则 |
| `docs/specs/workbench/views.md` | 视图标题动作的声明与渲染 |
| `docs/specs/workbench/files-explorer.md` | 工具按钮改为视图动作；根节点显示书名；行样式与展开动画；打开作品时揭示活动文件 |
| `docs/specs/workbench/editor.md` | 纸面版式；空态；选区恢复；最近打开记录；页面标签与 `editor.pages` |
| `docs/specs/workbench/bookshelf.md` | 欢迎页（`nbook.projects` 贡献）的内容与自动打开；显示名规则的引用 |
| 组件同名 `.md` | 外壳部件、编辑组、标签栏、资源管理器行与视图、欢迎页组件 |
| `packages/nb-ui/docs/design-language.md` | 工作台平铺与纸面的取舍（与外壳一的卡片做法的关系） |

## 切片

每片连同它对应的 Spec 与组件文档改动一起提交。

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S1 | 1、2 | 显示名、绑定带书名、引导带书名、加载页 | 两包 typecheck；`projects` 与 `browser-host` 测试；`projects.e2e.ts`、`browser-host.e2e.ts` |
| S2 | 3 | 平铺、线条、默认显隐、右缘竖条 | 工作台测试；`workbench-*.e2e.ts`；`lab-scenes.e2e.ts`；改动组件 `lab:shot` |
| S3 | 4 | 纸面、空态、选区恢复、最近打开记录 | 编辑器测试；`editor-area.e2e.ts` |
| S4 | 5 | 视图标题动作、资源管理器头部与根节点、行样式与动画、揭示 | 外壳与资源管理器测试；`files-explorer` 相关 e2e |
| S5 | 6 | 页面标签、欢迎页、自动打开与命令 | 编辑器与书架测试；新增欢迎页 e2e |
| S6 | — | 截图证据、全量 e2e、omp 实现审查与修正 | `test:affected --typecheck`、全量 e2e、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 由谁覆盖 |
|---|---|
| 目录名是中文、没写书名的作品，书架、标题栏、资源管理器根节点都显示目录原名 | `projects` 测试；`projects.e2e.ts` |
| 从书架打开作品：加载页先是居中进度条、随后出现书名，不出现无样式文字 | `browser-host.e2e.ts`（截帧读 DOM） |
| 新布局里右侧栏与面板不显示；用开关打开后刷新仍在；有视图贡献进去后出现 | 布局 store 测试；`workbench-views.e2e.ts` |
| 只剩三条线；编辑区是纸面 | `lab:shot` 截图（nbook、macos × 明暗 × 1280）；全场景门禁 |
| 关掉全部标签只剩一句提示 | 编辑组组件测试 |
| 刷新后回到同一个标签、光标在原处；内容被外部改短时光标夹到末尾 | 编辑器会话测试；`editor-area.e2e.ts` |
| 资源管理器标题行有五个动作按钮，点了与原来同效；根节点显示书名 | 视图动作测试；资源管理器 e2e |
| 打开作品时资源管理器展开到活动文件并选中 | 资源管理器 e2e |
| 选中行无描边；展开时新行淡入滑下，减少动画时不动 | 资源管理器组件测试 |
| 新作品第一次打开出现欢迎页；第二次打开回到上次的文件；“帮助 > 欢迎”能打开；欢迎页里的新建、最近打开、快捷入口、回到书架可用 | 欢迎页 e2e |

## 验证

- 每片按上表自跑；收尾跑全量 e2e 两轮、`lab-scenes` 门禁、变异检查（每条核心行为退回一次确认测试失败）。
- 真实浏览器观察：开发会话里从书架打开样例作品与空作品，走一遍第一眼、欢迎页、关掉全部标签、刷新恢复，nbook 与 macos 明暗各截一组存 `evidences/`。
- 未验证边界：桌面版的 WebKit 内核只做静态核对；手机宽度不在本 Task。

## 不做与风险

- 不做：章节的标题、分卷与顺序（剧情插件的活页夹，另建 Task）；手机宽度；正文宋体偏好；资源管理器的拖放（t67 已定）。
- 风险：
  - 平铺改掉了外壳一定下的卡片外观，涉及所有部件与 Lab 场景，`lab:shot` 全部重截核对；Spec 与设计语言写明取舍。
  - 虚拟列表的展开动画要和滚动、键盘移动不打架：动画期间仍按最终位置命中与聚焦，滚动时取消动画。
  - 页面标签是编辑区的新概念：只做欢迎页这一个使用者需要的部分（打开、关闭、不进会话），不做页面之间的拆分与拖动以外的能力。
- 待开发者确认的推荐（按推荐写进了上面）：快捷入口按“大纲”“设定”开头的名字找；最近打开存 10 个、欢迎页显示 5 个；加载页在应用起来前按系统明暗取底色；欢迎页刷新后不恢复；打开作品时只揭示一次活动文件。

## 第二轮：开发者手动审查之后（2026-10-12）

开发者看过 S1–S5 后改判了几条（README 第 13–17 条），并经第五到第十轮静态稿选定（`evidences/draft5-*.png` 到 `draft10-lockup.png`）：nbook 改回卡片（K2：标题栏与状态栏落在窗体底上，卡片不带外框、只有淡投影，深色补一圈淡外框；活动栏与侧栏合成一张卡，中间一条两端不碰顶底的短线；缝 4px，圆角 12px）；配色 P1（卡片仍是 `#fffcf5`／`#2d2925`，窗体底改暖灰 `#ece8df`／`#201d1a`），配色表里偏冷的控件色一并调暖；空态 E1（灰色标志与三条提示）；菜单浮层 M1（圆角 8px、投影收小、仍磨砂）；标题栏 L1（墨色横排标志，之后是项目切换，菜单在项目后）；加载页跟随产品的明暗。卡片还是平铺只由主题决定：nbook 卡片，macos 保持平铺（推荐，开发者未反对）。

### 7. 加载页跟随产品明暗（`src/web/host/`、两份 `index.html`、`host-loading.css`、`WorkbenchDocument.vue`）

- 工作台每次把主题写到文档根时，同时把这次的明暗与三种颜色（窗体底、正文色、强调色）记成浏览器本地的一条提示（`src/web/host/` 新增读写模块，读写面与 `client-identity.ts` 一样由调用方给出存储，存储不可用时静默放弃并不影响启动）。
- 两份 `index.html` 在 head 里加一小段同步脚本：读到提示就在 `<html>` 上写 `data-host-appearance` 与颜色变量；`host-loading.css` 按它取色，没有提示时仍按系统明暗。这个浏览器第一次打开时仍可能先暗后亮（接受）。
- 服务端没有 CSP，内联脚本不受限。

### 8. nbook 暖色与菜单浮层（`packages/nb-ui/themes/nbook/`、`packages/nb-ui/src/styles.css`）

- `colorways.ts`：浅色 `--bg-main #ece8df`、`--bg-sidebar #f4f0e8`、`--bg-hover #e7e2d8`、`--border-color #ddd7cc`、`--border-strong #c3bcb0`、`--shadow-color #3b342b`、`--overlay-bg` 与 `--shadow-panel` 跟随；深色 `--bg-main #201d1a`、`--bg-sidebar #272420`、`--bg-hover #3a3530`、`--border-color #3e3933`、`--border-strong #504a43`、`--text-inverse` 跟随；`--bg-subtle`、`--border-accent` 里的冷灰同步换掉。
- 菜单：nbook `--radius-menu` 改 8px；`.nb-ui-menu-surface` 的投影改读 `--elevation-menu`（缺省仍是 `--elevation-popover`），nbook 给小投影。菜单栏与下拉一起变。
- `design-language.md`：“冷暖分家”改写为主题可选的表达（nbook 改为暖色器械）；改后 `bun run --cwd packages/nb-ui build:css` 并提交 `dist/nb-ui.css`。

### 9. 卡片外壳（`plugins/workbench/web/shell/`、`WorkbenchShellLayout.vue`、各部件、nb-ui `Splitter`）

- 分隔方式是外壳读的主题变量，缺省即现在的平铺：`--shell-gap`（0）、`--shell-ground`（`--panel-surface`）、`--shell-card-radius`（0）、`--shell-card-shadow`（none）、`--shell-chrome-surface`（`--bg-panel`，标题栏与状态栏的面）、`--shell-chrome-line`（`--divider`，标题栏底线与状态栏顶线）、`--shell-seam`（`--divider`，网格接缝）、`--shell-join-divider`（transparent，活动栏与侧栏之间的短线）。nbook 在 `vars.css` 里给卡片的值并在 manifest 的 `declares` 登记；macos 不写，保持平铺。
- 缝：外壳布局新增纯函数，按投影的树、尺寸与边界占用算出每个部件哪一边贴着窗体（或标题栏、状态栏）、哪一边挨着别的部件、活动栏是否与侧栏相连；`WorkbenchShellLayout` 把结果写成插槽包装上的数据属性，样式按它给 `--shell-gap` 或一半的内边距，相连的两边不留缝、对应的圆角为 0。插槽里加一层卡片包装承担圆角、裁切与投影。活动栏叶宽不变（48px），卡片宽 44px 放得下 38px 按钮。
- 接缝：nb-ui `Splitter` 的静止接缝改读 `--nb-splitter-seam`（缺省 `--divider`，写进 `Splitter.md`），外壳根把它设成 `--shell-seam`。
- S2 里写死的平铺（外壳根底色、标题栏与状态栏的线）改读上面的变量；Lab 外壳场景随之有卡片。

### 10. 标题栏（`WorkbenchTitleBar.vue`、`src/ui/brand/`）

- 左组：墨色横排标志（现有 `NeuroBookLockup`，高 17px）→ 项目切换（书本图标加作品名，下拉不变）→ 一道短分隔 → 菜单；右组只剩布局按钮与条目区。三档宽度不变：600–959px 菜单收进“菜单”按钮；不足 600px 标志换成单独的图形标志、项目名截断。

### 11. 空态（`EditorGroup.vue`、`src/ui/brand/`）

- 新组件 `NeuroBookMark`（单独的图形标志，遮罩着色，同 `NeuroBookLockup` 的写法）。空态居中：标志（约 132px，正文色 9% 透明度）与三行提示：“显示所有命令”带命令面板的快捷键（从命令声明读、按平台写）；“新建文件”“打开欢迎页”写位置（资源管理器标题行、帮助 › 欢迎），点了执行对应命令；命令不存在或不可用时那一行不显示。

### 第二轮切片

| 片 | 对应设计 | 自跑验证 |
|---|---|---|
| S6 | 7 | `window`／`boot` 单元测试；`projects.e2e.ts` 加“系统深色、上次是浅色时第一帧是浅色” |
| S7 | 8 | nb-ui 测试与 `build:css`；`lab:shot` 菜单与下拉 |
| S8 | 9 | 外壳布局单元测试（各种位置、隐藏、拖到零下的边与相连）；`workbench-*.e2e.ts`、`lab-scenes`；`lab:shot` 外壳各部件 |
| S9 | 10 | `WorkbenchTitleBar.dom.test.ts`；`workbench-titlebar.e2e.ts` |
| S10 | 11 | `EditorGroup` 组件测试；`editor-area.e2e.ts` 空态 |
| S11 | — | 第一轮 omp 审查意见、第二轮切片的 omp 审查、全量 e2e 两轮、收口截图 |

Spec：`runtime/browser-host.md` 启动序列第 1、2 步（加载页取上次的明暗）；`ui/workbench-shell.md` 输出 38、39 与验收 41、42 改写为“分隔方式由主题决定”，标题栏一节改左组顺序；`workbench/editor.md` 空态；`theme/system.md` 记 `--shell-*` 变量；组件文档随改。
