---
schema: nbook.task/v2
taskId: t79-workbench-polish
---

# 工作台打磨：打开项目之后的那一页

## 目标与范围

开发者 2026-10-12 问到“打开项目、进入工作台的页面设计做好了没有”。没有：外壳（t65–t74）、资源管理器（t70）、编辑器区（t71）功能齐了，从书架点作品或“继续写作”能进入工作台，但这一页没有像书架那样走过“注意力排序 → 静态稿 → 开发者确认”。t76 当时把“工作台与资源管理器的打磨”列为后续 Task；外壳各片的外观在自主推进期间只留了截图，开发者还没看（[待确认清单](../../pending-confirmations.md) 2026-10-08 第 2 条）。开发者选：设计讨论马上开始、与 t78 实现并行，实现排在 t78 之后。

范围（设计阶段先确认，确认后按结果修订）：

- 打开项目后的第一眼：先看到什么、默认展开或收起什么；
- 没有打开文件时编辑区的空态；
- 从书架到工作台的加载与过渡；
- 标题栏、活动栏、资源管理器、状态栏的外观与信息密度。

不做（设计阶段再核对）：t78 已定的焦点样式与按钮尺寸（随 t78 实现，本 Task 的稿子建立在它之上）。

行为合同：设计确认后定改哪些，候选是 [`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)、[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md)、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)、[`workbench/bookshelf.md`](../../../../../docs/specs/workbench/bookshelf.md)（继续写作的入口）。

## 前置

[t77](../t77-bookshelf-polish-2/README.md) 提交后开始；实现排在 [t78](../t78-lab-layout-baseline/README.md) 之后。

## 当前状态

- 2026-10-12 建立，设计阶段：先和开发者确认注意力排序，再出静态稿。
  - 现状截图（开发会话，临时目录里的样例作品“雾港”，从书架进入）：[书架](evidences/now-0-bookshelf.png)、[刚打开](evidences/now-1-opened.png)、[打开一章](evidences/now-2-chapter.png)、[手机](evidences/now-3-phone.png)。看到的：作品名处处显示成 `project`（目录名是中文）；章节按名字排成“第二章、第三章、第一章”，文件名带 `.md`（普通文件夹按合同只显示真实文件名，章节的标题与顺序归剧情插件的活页夹，还没做）；右侧栏与底部面板默认开着、只有“将视图拖动到此处显示”；没打开文件时编辑区只有一行灰字，正文底色是灰的；手机宽度各区上下摞在一起。
  - 开发者确认的注意力排序：
    1. 打开作品回到上次写的地方：打开上次的文件、光标在上次的位置，资源管理器展开到它所在的目录并选中它；空作品的编辑区给“新建第一章”的入口。
    2. 不碰章节结构：“上次写的”就是上次打开的文件；资源管理器照现行合同显示文件名。章节的标题、分卷与顺序归剧情插件的活页夹，另建 Task。
    3. 没有视图的右侧栏与底部面板默认隐藏，标题栏开关与命令仍能打开。
    4. 手机宽度这次不做，只做桌面宽度。
  - 第一轮静态稿（真实工作台上切换显隐、注入候选样式，不改源码）：[第一眼](evidences/draft-first-glance.png)（A 现状、B 纸面无衬线、C 纸面宋体、D 灰底上一张纸）、[空态](evidences/draft-empty-states.png)（E 空作品、F 关掉全部标签后）。（更正：起初以为重新打开作品时编辑区不恢复，实为截图脚本打开文件后不到两秒就离开、会话记录还没写入；编辑器已按 `editor.md` 输出 5 恢复上次的标签，书架的“继续写作”按输出 29 把光标放到文末。还缺的是光标位置、资源管理器展开到当前文件并选中、新作品自动打开欢迎页。）
  - 开发者选：
    5. 编辑区用 B：去掉灰底，编辑区与面板同色；正文用界面字体，17px、行距约 1.95、版心 720px。宋体以后做成偏好。
    6. 空态合成一个：空编辑区统一给“新建”入口，有最近打开的文件时一并列出。（第 9 条改判）
  - 第二轮静态稿：[资源管理器与卡片](evidences/draft2-explorer.png)、[合成空态](evidences/draft2-empty.png)、[加载过渡](evidences/draft2-loading.png)（现在从书架进入：白底、左上角无样式的字，跳到中间后空白，约 1 秒才出现工作台）。
  - 开发者选：
    7. 资源管理器的五个工具按钮改 24px 并进标题行右侧，去掉带框的浮条；根节点显示书名。
    8. 外壳从圆角卡片加灰缝改为平铺：底色与纸面统一，侧栏贴边、用分隔线；右侧栏与面板打开时同样平铺。
    9. 加载过渡用米色底、居中书名加细进度条（要在应用起来之前拿到书名）。
    10. 空态与欢迎页分开：关掉全部标签后的编辑区只有一句提示；另做欢迎页，是编辑区里的一个标签，新作品第一次打开（没有上次的文件）时自动打开，平时从“帮助”菜单或命令打开。内容：作品概况（书名、简介、字数与篇数）、新建章节与最近打开、入门提示、快捷入口（大纲、设定这类常用文件有就显示，回到书架）。
  - 第三轮终稿：[合在一起](evidences/draft3-final.png)、[欢迎页](evidences/draft3-welcome.png)。开发者意见：参考旧应用的文件树；边框太多。
    - 旧文件树（`packages/neuro-book-legacy/app/components/novel-ide/workspace/WorkspaceFileTree.vue`、`WorkspaceFileNode.vue`）用的是原生 HTML5 拖放，dnd-kit 用在旧应用的编辑器标签、工作台视图与剧情场景列表上；新应用的拖放在 t67 改为自写指针会话。旧树源码与提交里没有记下的坑，只有区分单击与双击的延迟。外观上：选中只用强调色浅底与强调色文字、不描边，行带圆角，箭头半透明，展开收起 220ms 高度动画。
    - 终稿上数出 8 条线（标题栏、活动栏、侧栏、资源管理器标题行、选中行描边、标签栏底线与标签竖线、状态栏）；平铺后侧栏右边框贴着外壳网格本来就有的 1px 拖动分隔条，成了两条竖线。[精简对照](evidences/draft4-lines.png)。
  - 开发者选：
    11. 线条只留三条：标题栏底线、侧栏与编辑区之间一条竖分隔（用网格的分隔条）、状态栏顶线；标签栏不画线，当前标签加粗。
    12. 文件树搬旧树的三样：选中只用浅底、不描边；行带圆角；展开收起有动画（系统减少动画时不动）。

- 2026-10-12 深色核对：[深色终稿](evidences/draft4-dark.png)，对比度与线条正常；页面最右有一条约 10px 的竖条，是根上预留的滚动条位置（`scrollbar-gutter: stable both-edges`），计划里处理。计划见 [plan.md](plan.md)，开发者 2026-10-12 全部同意（含五条按推荐写入的细节：快捷入口按“大纲”“设定”开头的名字找、最近打开存 10 个显示 5 个、加载页在应用起来前按系统明暗取底色、欢迎页刷新后不恢复、打开作品时只揭示一次活动文件）。
- 2026-10-12 S1（书名与加载页）完成：
  - 显示名改为“书名，没有书名时用目录原名”：共用的 `projectFolderName`（`src/shared/projects.ts`，两种路径分隔符都认），书架的 `projectDisplayName` 改用它；短名只留在地址栏、日志与页面根的 `data-workbench-project` 上。
  - 书名不进内核线协议（`ProjectBinding` 是 nb-runtime 的帧类型），改经引导接口：请求带 `project` 时服务端查登记表与身份文件，响应附 `project: {title}`（项目管理器的 `displayTitle`，读不出身份文件时退回目录名并记诊断；管理器还没建好或没登记时不带）。窗口的作品信息 `WindowProject.project` 加 `title`，标题栏与状态栏显示它；引导拿不到时退回短名。
  - 加载页：两份 `index.html` 在 head 里引用 `src/web/host-loading.css`（阻塞渲染），静态占位从第一帧起是主题缺省配色的底色（明暗跟随系统）上居中的进度条，不带文字；前端入口订阅窗口状态，引导给出书名后写进占位的书名与“正在打开”两处，进度条不动。宿主页的“启动中”用同一套类名。
  - Spec：`runtime/projects.md`（短名与显示名的术语）、`runtime/browser-host.md`（启动序列第 1、2、5 步，追加验收 12）、`workbench/bookshelf.md`（显示名、已打开窗口的标题栏）、`ui/workbench-shell.md` 输出 12。
  - 验证：
    - `browser-bootstrap.test.ts` 用真实服务端登记中文目录（短名是 `project`）：引导给目录原名，写了书名后给书名，没登记、没带参数时不带；`window.test.ts` 绑定项目时先发出带书名的启动中、就绪后作品信息带 `title`；`FailurePage.dom.test.ts`、`shelf-format.test.ts` 补用例；两包 typecheck 为 0。
    - e2e：`projects.e2e.ts` 新增验收 12（`addInitScript` 记下页面解析完时加载页已是 `position: fixed`、出现过的书名只有“雾港”、宿主状态只有 `loading`，就绪后标题栏是“雾港”、页面根仍是短名 `project`）；`bookshelf.e2e.ts` 里打开已有目录的用例改按目录原名找卡片；`projects`、`browser-host`、`bookshelf`、`bookshelf-stats`、`workbench-titlebar` 共 24 例全过。
    - 变异 6 处全部被抓到（目录原名返回整条路径、引导不理会 `project`、窗口引导不带项目、入口不写书名、标题栏显示短名、`index.html` 不引用加载页样式）。
    - [加载帧](evidences/s1-loading.png)（开发会话，拖住 RPC 升级 600ms）：浅色与深色第一帧都是底色加进度条，书名随后出现在上方、进度条不动；深色系统、浅色产品设置时就绪后底色切换一次（计划里接受）。深色帧右缘露出根上预留的滚动条位置，归 S2。

- 2026-10-12 S2（平铺、三条线、空区域缺省不显示、右缘竖条）完成：
  - 平铺：活动栏、工具区、面板去掉卡片外框、圆角与 6px 留白（`SHELL_GUTTER_PX` 删除，活动栏宽 48px），外壳根改用面板底色；工具区、视图、面板的标题行不画底线；编辑器标签栏去掉底线与标签竖线，活动标签加粗。nb-ui `Tabs` 加 `baseline`（默认 true），右栏与面板的容器标签带关掉底边线。工作台页根改 `scrollbar-gutter: auto`，右缘不再空出一条。
  - 空区域缺省不显示：`layout-store` 的“空着”是“现在没有容器，也没有视图把它声明为默认位置”；只看现在的容器时 e2e 暴露出拖空的右栏与面板当场消失、不再是落点（外壳三验收 20、24），改为声明也算。右栏主动显示过记进 `views-customizations` 的可选字段 `shownParts`（再隐藏就撤掉），面板沿用显式的 `panel.hidden`。经“移动到”放进不显示的空区域时区域随之显示。
  - 加粗带来的两处修正：标签按加粗预留宽度（文字与看不见的加粗副本叠在一格），切换活动标签时其它标签不移动；标签条末尾留 4px，编辑组左缘落在半像素上（右栏隐藏后 1280 宽的拆分组在 834.5）时浏览器把可滚动宽度向下取整，最后一个标签滚到底仍被裁掉约 1px。
  - Lab：外壳场景的夹具去掉三块占位卡片与面板顶线，与产品一致。
  - Spec：`ui/workbench-shell.md` 输出 3（活动栏 48px）、9（引向 39），新增“工作台打磨”一节输出 38、39 与验收 41、42，状态表与数据一节记 `shownParts`；`design-language.md` 新增“铺满窗口、由可拖边界拼起来的工作台平铺”；组件文档 `WorkbenchShell`、`WorkbenchShellLayout`、`WorkbenchActivityBar`、`WorkbenchToolPartHost`、`WorkbenchPanelSurface`、`WorkbenchViewSection`、`EditorTabBar`、nb-ui `Tabs`。
  - 验证：
    - 工作台 bun 测试 185 例、工作台与编辑器等的 vitest 129 例、nb-ui 554 例全过，两包 typecheck 为 0。`layout-store.test.ts` 新增“空着的右栏与面板”三例（空目录缺省都不显示且不写盘、主动显示后刷新仍在、再隐藏撤掉；声明在这里的视图拖走后仍显示；“移动到”放进空区域随之显示）。
    - 最终代码上跑 e2e 全套 164 例：163 过，`settings` 一例的断言全过、在关闭上下文时 Playwright 写 trace 截图报 ENOENT，单独重跑该文件 4 例全过。为新外观改的断言：`workbench-views` 的颜色一例改查底色并加“部件无边框与圆角”（含两条容器标签带）；`workbench-shell` 外壳根底色改 `--panel-surface`、加面板标题行无底线与外壳贴到视口右缘；`settings` 的外壳根探针改 `--panel-surface`；`editor-area` 第一例加标签条无线、活动标签加粗、切换时宽度不变，拆分一例多开三个文件（右栏隐藏后组变宽，原来四个标签放得下）。外壳组的 `open()` 为新客户端显示右栏与面板一次再开始（产品页这两处没有视图）。“隐藏、收起、最大化”一例改为等面板长满：最大化时编辑器立刻停放、面板高度随后以动画长满（逐帧采样 200→842 约 150ms），原来的立即读数靠时机碰巧通过。
    - 变异 18 处全部被抓到：store 8 处（空着只看容器、只看声明、不看主动显示、空右栏不隐藏、空面板不隐藏、显示不记、隐藏不撤、所有区域都记），外观 10 处（活动栏外框、工具区标题行底线、外壳底色、根预留滚动条、标签条底线、不预留加粗宽度、活动标签不加粗、标签条末尾不留余量、两条容器标签带的底边线）。
    - `lab:shot` 外壳、活动栏、面板框架、视图分节、标签栏在 nbook、macos × 明暗 × 1280 下问题 0 条；Lab 门禁通过。[平铺对照](evidences/s2-flat.png)（开发会话的雾港，nbook、macos × 明暗，以及显示右栏与面板后）：可见的线只有标题栏底线、侧栏与编辑区的接缝、状态栏顶线，右缘贴边。编辑区的灰底归 S3。

- 2026-10-12 S3（纸面、一句话空态、光标恢复、最近打开）完成：
  - 纸面：编辑区、编辑组与标签条改用面板底色；Markdown 控件的版心、留白、字号、行距、段距做成控件根上的变量，取开发者选定的 B 稿数值（720px 含左右各 48px、上 64px 下 120px、17px、1.95、1.1em）。空态改为内容区正中一行淡色的“在左边的资源管理器里打开一个文件”。
  - 光标：组模型的标签加可选的 `cursor`（Markdown 记 `{offset}`，源码记 `{line, column}`，写法与编辑器对不上的不记、不恢复；换编辑器丢掉，拆分带过去），会话记录的 schema 加可选字段、版本不变。视图绑定带上标签记下的光标与 `remember`；两个控件在第一次为文档建视图状态时放回光标并滚到它，光标停下 1 秒、失焦、换文档时交出。Markdown 按文档大小夹到末尾；Monaco 的 `setPosition` 自己按模型校正（写了显式夹取后变异存活，删掉了）。恢复会话时复用继续写作的等待与取消，活动标签就绪后只聚焦；读取失败不另提示。
  - 最近打开：新记录 `editor.recent`（project/local，至多 10 个，最近在前），编辑器区的 `open` 交出地址，会话里建 store；欢迎页（S5）从会话取。
  - Spec：`workbench/editor.md` 新增输出 30–32、验收 17–19，数据一节记 `cursor` 与 `editor.recent`；组件文档 `MarkdownControl`、`MonacoControl`、`EditorGroup`、`EditorArea`。计划里“记录版本加一”改为版本不变（加一会让 Storage 把旧记录判为不支持的版本、整个会话丢掉）。
  - 验证：
    - 编辑器 bun 测试 93 例全过（`area.test.ts` 新增“上次的光标与最近打开”四例，`groups.test.ts` 加快照往返一例，新增 `recent.test.ts` 两例在真实 Storage 场地上）；相关 vitest 81 例全过，typecheck 为 0。
    - e2e：`editor-area` 新增“纸面与空态”“重新打开回到上次的光标”两例（源码文件光标第 2 行第 4 列、Markdown 光标在正文中间、另一个 Markdown 光标在末尾，外部把两个不活动的文件改短后刷新：直接输入落在 Markdown 原来的光标处，源码光标夹到第 1 行行尾，改短的 Markdown 打开无页面错误；`editor.recent` 按打开先后排好）。`bookshelf-stats` 原来用“刷新后正文没有焦点”代表“不再按继续写作定位”，恢复会话后会聚焦，改成刷新前把光标挪到开头、刷新后输入落在开头；同一例里紧跟中文输入后的第一个 Ctrl+Home 被吞（光标留在末尾，0.5 秒后再按就动了，dev 会话里手动不复现），改为先等标签变成未保存再按，原因没有查明。`settings` 的空态文字随之改。
    - e2e 全套 166 例：165 过；`workbench-titlebar` 的“从编辑菜单撤销”一例在全套里失败一次（F10、右、回车后“撤销”项没拿到焦点），单独跑 3 次、`--repeat-each 8` 全过，判为负载下的偶发，没有查明。
    - 变异 24 处：store 与模型 14 处全部被抓到；控件与样式 10 处有 9 处被抓到，存活的是 Monaco 的显式夹取，已删掉。
    - `lab:shot` 编辑器区在 nbook、macos × 明暗下问题 0 条（默认 300ms 截图时正文还没读到，等 2.5 秒后纸面正常）。[空态与纸面](evidences/s3-paper.png)。

- 2026-10-12 t78 的 omp 实现审查处理完（见 t78），与本 Task 的切片分开提交。
- 2026-10-12 S4（视图标题动作、根是书名、行的样子与展开动画、打开作品时揭示活动文件）完成：
  - 视图标题动作：`ViewDeclaration` 加可选 `actions`（命令、图标、标题、`args: "instance"`、`toggled`），声明类型改为深只读（布局 store 的目录本来就是深只读，数组字段让两边对不上）。外壳的 `chrome` 加 `viewActions`（可用与原因看命令自己的 `when`，按下态读 `toggled` 的公开键）与 `runViewAction`（instance 动作带上实例层的代际）；新组件 `WorkbenchViewActions` 画 24px 按钮，single 的侧栏与右栏在容器标题行、面板在标签带旁、multiple 在视图标题行，都在“移动到”之前；Lab 登记三个场景。资源管理器的五个按钮改为声明的动作，删掉视图里的工具栏，新增公开键 `nbook.explorer/showManifests` 作按下态。
  - 根是书名：窗口的作品信息（S1 的 `project.title`）经视图宿主、视图、树传到行，项目根显示书名；没有绑定项目时仍是“项目”。
  - 行的样子：行左右各离边 6px，圆角块的悬停与选中底色；焦点行的线改为只在树是键盘带来的焦点时画 1.5px 内嵌线（原来鼠标点行也画 1px，就是终稿上数到的“选中行描边”）。展开收起：树在展开集合变化后的一个 `--motion-base` 里打 `data-expanding`，`TransitionGroup` 只在这时让新行滑下淡入、离开的行反向、其余行的 `top` 过渡；滚动带来的进出不动画，减少动画时不打标记。
  - 揭示：控制器加 `reveal`（展开各级祖先，行出现后选中并给焦点行，用户先选了别的行则作废）；编辑器新增公开键 `ready` 与 `activeDocument`；资源管理器在控制器与编辑器区都建好后等一个微任务（继续写作在同一刻打开它的文件）读活动标签，揭示一次。计划里“保留现有的手动揭示命令”不成立：没有这条命令，本 Task 不新增。
  - Spec：`workbench/views.md` 输出 10、验收 7，非目标里去掉“标题动作”；`workbench/files-explorer.md` 的“标题动作”“行的样子”“打开作品时揭示活动文件”三段与验收 17–19，根的标题，“工具栏”的说法改为标题动作；`workbench/editor.md` 两个公开键；`workbench/commands.md` 的 `refresh-files` 触发面。组件文档 `FilesExplorerView`、`ExplorerTree`、`ExplorerRow`、`WorkbenchShell`、`WorkbenchViewActions`。
  - 验证：
    - bun 测试 379 例（新增 `workbench/view-actions.test.ts` 在真实内核的命令系统与公开状态上测可用、原因、按下态与 instance 参数，`browse.test.ts` 加“揭示一个地址”）、vitest 165 例全过，typecheck 为 0。这个内核测试起初放在 `web/titlebar/` 下，被浏览器测试的 tsconfig 收进去、带进了后端的 `proper-lockfile`（类型声明只在 node 配置里），挪到插件根目录。
    - e2e 全套 171 例全过。新增：`files-explorer` 的“项目根是作品名、标题行五个动作、展开动画与焦点线、减少动态”一例，`editor-area` 的“打开作品时揭示一次”一例；原来点 `[data-explorer-tool]` 的改点 `[data-view-action]`。`files-explorer` 的拖动一例按顺序跑时稳定失败：展开目录后立即量行的位置再按下，行还在滑动，按下时指针下面换成了上一行（实际拖走的是 `keep`）；用户按的是看得见的位置，产品的命中按 `elementsFromPoint` 没问题，测试的 `dragOver` 改为先等 `data-expanding` 撤掉。
    - 变异 12 处全部被抓到（动作不看命令可用、按下态总为假、instance 不带实例、揭示不展开祖先、不等行出现、右键选中不作废揭示、打开作品不揭示、根不用作品名、焦点线不看 focus-visible、展开不打标记、外壳不画动作、清单开关不带按下态）。
    - `lab:shot` `WorkbenchViewActions`、`ExplorerRow`、`ExplorerTree`、`FilesExplorerView` 在 nbook、macos × 明暗下问题 0 条；[揭示与标题动作](evidences/s4-explorer.png)（开发会话，收起“正文”后刷新：展开到第二章并选中）。

- 2026-10-12 S5（欢迎页）完成：
  - 页面标签：编辑器新增贡献点 `editor.pages`（声明标题、图标、`openOnFirstVisit`，实现交出组件）与命令 `nbook.editor.open-page`。页面标签的地址是 `page://<id>`，窗口里只开一个，切过去时连同它所在的组；它没有文档：不读盘、不算 dirty、没有光标，不能拆分、不能换编辑器，`nbook.editor.open` 不接受这类地址。会话快照只收文件标签，活动的是页面时记它左边最近的文件标签；公开键 `activeDocument` 为空串。“第一次打开”看会话记录读到“不存在”，带继续写作参数时不开。
  - 欢迎页由 `nbook.projects` 贡献：宿主（`web/welcome.ts`）每次挂上时取书架条目（简介与统计）和项目根的列出（快捷入口），新建章节在项目根按 `新章节.md`、`新章节 2.md`……避开已有名字建空文件再以正式标签打开，快捷入口的文件经 `nbook.editor.open`、文件夹经新命令 `nbook.files.reveal {expand: true}`，回到书架整页导航；组件 `WelcomePage` 是受控零件，命令面板的快捷键按平台写成按键。帮助菜单加“欢迎”（`nbook.help.welcome`；起初叫 `nbook.projects.welcome`，被内置命令的 domain 清单拒绝）。对文件服务的依赖可选：项目插件的测试装配没有文件插件，必需依赖会让它激活失败。
  - Spec：`workbench/editor.md` 输出 33、验收 20、`editor.pages` 输入与数据一节；`workbench/bookshelf.md` 新增“欢迎页”输出 18–20、验收 10–12；`workbench/commands.md`（`nbook.help.welcome`、`nbook.files.reveal`、`open-page`）、`workbench/files-explorer.md` 揭示命令、`ui/workbench-shell.md` 帮助菜单。组件文档 `WelcomePage`（新）、`EditorGroup`、`EditorArea`。计划第 6 节补了实施中的修订。
  - 验证：
    - bun 测试 777 例过、1 例失败：`settings/commands.test.ts` 的“项目层覆盖着主题时……”报工作台 `provider-blocked`，在 S1 之前的提交（`3800c43f~1`）的临时 worktree 里同样失败，不是本 Task 引入的，没有处理。vitest 168 例全过，typecheck 为 0。新增 `welcome.test.ts`（快捷入口的筛选与次序、新章节的名字）、`WelcomePage.dom.test.ts` 三例、`area.test.ts` 的“页面标签”、`groups.test.ts` 的“页面标签不进快照”，`projects.test.ts` 断言帮助命令登记成功。
    - e2e：新增 `welcome.e2e.ts` 三例（验收 10–12）；全套 174 例全过。
    - 变异：单元 12 处全部被抓到；e2e 5 处抓到 4 处，存活的是“活动页面时 `activeDocument` 仍报页面地址”（e2e 里没有读它的地方），补了 `area.test.ts` 的断言后被抓到。
    - `lab:shot` `WelcomePage` 五个场景（作品、新作品、新建失败、没有绑定项目、英文）问题 0 条。[欢迎页](evidences/s5-welcome.png)（开发会话的雾港新客户端，与 Lab 的新作品场景）。

- 2026-10-12 S6 进行中：收口截图 [nbook](evidences/s6-final-nbook.png)、[macos](evidences/s6-final-macos.png)（开发会话，每个主题与明暗一个新客户端：第一次打开雾港是欢迎页；打开第二章、关掉欢迎页后刷新回到第二章并在资源管理器里选中；关掉全部标签是一句话空态；空作品是欢迎页；无页面错误）。omp 实现审查在跑。
- 2026-10-12 开发者手动审查，提出的意见与处理：
  - 开发者选：
    13. 外壳改回卡片分隔（改判第 8、11 条的平铺与“只留三条线”）：线条太细、边界模糊，要旧应用那种卡片。卡片还是平铺只由主题决定：外壳读主题变量（部件间的缝、部件圆角、外框与阴影），nbook 用卡片，不加设置项。
    14. 空态加一个灰色的标志与几条快捷键提示，像 VS Code（改判第 10 条的“只有一句提示”）。
    15. 加载页跟随产品的明暗（改判计划里“加载页在应用起来前按系统明暗取底色”）：开发者系统是深色、产品是浅色，进入工作台时加载页是暗的。
    16. 菜单浮层与菜单按钮不搭（浮层圆角 12px、磨砂与较大的阴影，按钮圆角约 4.5px）：在 t79 里调。
    17. 标题栏加标志、调整项目切换的位置（开发者稍后补充）。
  - 第五到第十轮静态稿（真实工作台上注入候选样式）与开发者的选择：
    - [卡片、空态、菜单](evidences/draft5-cards.png)（另见 [空态](evidences/draft5-empty.png)、[菜单](evidences/draft5-menu.png)）：空态选 E1（灰色标志与三条提示），菜单选 M1（圆角 8px、投影收小、仍磨砂）；卡片在当时的冷灰底下倾向 K1，认为灰底配色有问题。
    - [底色](evidences/draft6-ground.png)、[配色](evidences/draft7-palette.png)：选 K2（标题栏与状态栏落在窗体底上，卡片不带外框），活动栏与侧栏合成一张卡、中间画一条两端不碰顶底的短线，缝 4px；配色 P1（卡片不变，窗体底改暖灰 `#ece8df`，深色 `#201d1a`）。
    - [控件色](evidences/draft8-warm.png)：配色表里偏冷的控件色一并调暖（nbook 不再“冷暖分家”）。
    - [标题栏](evidences/draft9-titlebar.png)、[横排标志](evidences/draft10-lockup.png)：用带 NeuroBook 字样的横排标志（墨色），之后是项目切换，菜单在项目后。
  - 实现计划见 [plan.md](plan.md) 的“第二轮”。
- 2026-10-12 S6（加载页跟随产品明暗）完成：
  - 宿主的前端入口观察文档根上的主题（明暗、主题包与配色的内联变量），每次变了把明暗与面板底色、正文色、淡色、强调色（借一个元素算成 rgb）记进本地存储 `nbook.host-appearance`；两份 `index.html` 头部同一段内联脚本在第一帧前读回，写到根上的 `data-host-appearance`、`color-scheme` 与 `--host-loading-*`，`host-loading.css` 先取这些变量，没有时仍按系统明暗。写放在宿主而不是工作台插件：前端规范不许组件直接读写本地存储。Lab 也写文档根，在 Lab 里切过明暗，下次加载页取的是 Lab 最后的明暗（接受）。
  - Spec：`runtime/browser-host.md` 启动序列第 1 步、新增场景 13、实现合同与合同测试。
  - 验证：`appearance-hint.dom.test.ts` 四例（两份内联脚本一字不差；宿主写下的提示由内联脚本读回；还没写主题不记、存储不可用只说一次；坏记录与坏颜色不认）；`browser-host.e2e.ts` 新增场景 13（系统与产品明暗相反的两个方向：第一次按系统，刷新后第一帧是产品的底色），连同 `projects.e2e.ts` 共 13 例全过；typecheck 为 0。变异 6 处：起初存活 1 处（浅色系统下的样式不读提示，用例只测了系统深色一个方向），补上反方向后全部被抓到。
- 2026-10-12 S7（nbook 暖色与菜单浮层）完成：
  - nbook 配色表里原来的冷灰换成暖色：浅色窗体底 `#ece8df`、侧栏底 `#f4f0e8`、悬停 `#e7e2d8`、边框 `#ddd7cc`／`#c3bcb0`、阴影基色 `#3b342b`；深色窗体底 `#201d1a`、侧栏底 `#272420`、悬停 `#3a3530`、边框 `#3e3933`／`#504a43`；`--bg-subtle`、`--border-accent`、`--shadow-panel`、`--overlay-bg`、深色 `--text-inverse` 同步。纸（`--bg-panel`）不变，“纸比桌亮”等三条不变量仍成立。配色文件开头与角色映射的说明改写（器械与纸同一色相、靠明度分层）；`design-language.md` 的内容角色表与“冷暖分家”一段改为冷暖由主题选。
  - 菜单：nbook `--radius-menu` 12px 改 8px；nb-ui 新增 `--elevation-menu`（缺省等于 `--elevation-popover`），`.nb-ui-menu-surface` 读它，nbook 给一圈 0.5px 细边加一层近投影；`ui-development-spec.md` 补一句。`dist/nb-ui.css` 重新生成。
  - 验证：nb-ui 554 例全过；新应用的测试里没有写死旧色值；`lab:shot` 的 `Menubar`、`Dropdown`（禁用场景点不开、跳过）在 nbook、macos × 明暗下问题 0 条；开发会话实测标题栏“文件”菜单圆角 8px、投影为新的两层，窗体底 `rgb(236, 232, 223)`。
- 2026-10-12 S8（卡片外壳）完成：
  - 卡片还是平铺是主题变量（`--shell-gap`、`--shell-ground`、`--shell-card-radius`、`--shell-card-shadow`、`--shell-chrome-surface`、`--shell-chrome-line`、`--shell-seam`、`--shell-join-divider`），缺省即平铺；nbook 在 `vars.css` 给卡片的值（缝 4px、圆角 12px、浅色淡投影、深色一圈淡外框、标题栏与状态栏透明无线、接缝透明、短线 `--divider`）并在 manifest 的 `declares` 登记（fallback 是平铺），macos 不写。
  - 缝的几何：新纯函数 `shell/cards.ts` 读投影的树、尺寸与边界占用，给每个部件四边各挨着什么（贴边、相邻并累计中间的边界与零宽部件、与活动栏相连）；外壳布局组件把它写成插槽包装的内边距（贴边整缝、相邻半缝减去一半占用、相连 0），里面一层卡片包装承担圆角、裁切与投影，活动栏与通高侧栏相接的角为 0、中间一条离顶底 10px 的短线。包装按部件身份静态套上：随投影出现或消失的话插槽会换处渲染、部件内容被重建。网格接缝经 nb-ui `Splitter` 新开的 `--nb-splitter-seam` 改色。
  - 活动栏：Lab 门禁报 38px 按钮的外扩光环被 44px 的卡片裁掉。叶宽改为 48px 加上主题缝宽（`projectShell` 新输入 `cardGap`，外壳布局从文档根读 `--shell-gap`，主题或明暗变化时重读），卡片保持 48px；固定叶上下限表里不再用的活动栏一项删掉。
  - 顺带：`WorkbenchShell.vue` 里自 t66 起没人用的 `.workbench-shell__card` 删掉；Lab 外壳场景的根改用 `--shell-ground`，编辑器、面板占位补上面板底色，场景里看得出卡片。
  - Spec：`ui/workbench-shell.md` 输出 3、38 改写（卡片还是平铺由主题决定）、验收 41 改写、合同测试与 Smoke、批准依据；`theme/system.md` 记 `--shell-*`；`workbench/editor.md` 输出 32 的底色说法。`design-language.md` 的“工作台平铺”一节改为“卡片还是平铺由主题决定”。组件文档 `WorkbenchShellLayout`、`WorkbenchShell`、`WorkbenchTitleBar`、`WorkbenchStatusBar`、`WorkbenchActivityBar`、`WorkbenchToolPartHost`，nb-ui `Splitter`。
  - 验证：`cards.test.ts` 七例（缺省布局、右栏、侧栏拖到零、侧栏隐藏与面板跨到侧栏下方、活动栏隐藏、右侧面板与最大化、紧凑呈现、留白算式），`layout.test.ts` 加缝宽一例，工作台 bun 测试与组件测试全过，nb-ui 554 例全过，typecheck 为 0。e2e：`workbench-views` 的颜色一例改为按主题验分隔方式（nbook：活动栏卡片离左缘与标题栏各 4px、宽 48px、与侧栏相连且相接角为 0、短线是 `--divider`、侧栏与编辑区之间 4px、圆角 12px、标题栏底线与接缝透明；切到 macos：贴边、1px 接缝、`--divider` 的线、没有短线），`workbench-shell` 与 `settings` 的外壳根底色改读 `--shell-ground`、状态栏读 `--shell-chrome-*`，`editor-area` 纸面一例改为编辑区是面板底色、外壳根是窗体底；外壳、视图、拖放、设置、编辑区、标题栏与 Lab 场景门禁共 79 例（修正后重跑 70 例）全过。`lab:shot` 外壳场景、活动栏、面板框架、标题栏、状态栏在 nbook、macos × 明暗 × free、phone 下问题 0 条。变异 11 处全部被抓到（相连不看侧栏通高、不往邻居分支里累加零宽孩子、零尺寸兄弟也算邻居、半缝不扣占用、活动栏叶宽不加缝、卡片不圆角、相连的角照样圆、接缝不改色、布局不读主题缝宽、外壳根不用窗体底、标题栏仍画底线）。
- 2026-10-12 S9（标题栏）完成：
  - 左组依次是横排标志（`NeuroBookLockup`，墨色跟随文字色，高 17px）、项目切换（书本图标加显示名，下拉从左边展开）、16px 高的短分隔与菜单入口；右组只剩布局按钮与条目区。最窄一档（不足 600px）把横排标志换成单独的图形标志。左组变宽后，960px 附近“左右等分”放不下：左栏改为最小取内容宽，空间够时搜索仍在正中，不够时往右让。
  - 新组件 `src/ui/brand/NeuroBookMark.vue`（单独的图形标志，遮罩着色，同 `NeuroBookLockup` 的写法；品牌目录的 README 早就提到它，文件此前不存在），登记 Lab 场景。
  - Spec：`ui/workbench-shell.md` 输出 28 与宽度三档、验收 32、批准依据；组件文档 `WorkbenchTitleBar`、`NeuroBookMark`（新）。
  - 验证：`WorkbenchTitleBar.dom.test.ts` 加“左组顺序”一例（6 例全过）；`workbench-titlebar.e2e.ts` 的宽度三档一例加左组顺序与最窄一档的图形标志；标题栏、外壳、项目、书架、欢迎页与 Lab 场景门禁共 33 例全过；typecheck 为 0。开发会话截图与第十轮稿 L1 一致。变异 4 处全部被抓到（标志写回文字、分隔放到菜单后、最窄一档仍是横排标志、左栏不按内容撑开）。
- 2026-10-12 S10（空态）完成：
  - 没有标签的编辑组正中是淡色的图形标志（`NeuroBookMark`，132px，组很矮时先缩）与三行提示，说明靠右、按键或位置靠左（每行一个按钮，用 subgrid 跨两列对齐，按钮仍可聚焦）：“显示所有命令”写命令面板的快捷键（从命令声明读、按平台写，mac 是一串符号），“新建文件”“打开欢迎页”写入口位置；命令不存在或不可用时那一行不显示，点一行由插件经命令服务执行。
  - 新模块 `editor/web/empty-tips.ts`（三条提示的定义与筛选）；插件在渲染时求值（可用性读公开状态，命令增减记版本号），`EditorArea` 与 `EditorGroup` 加 `emptyTips` 与 `run-tip`。工作台合同补导出 `KeyPlatform`。编辑器文字表里原来那句空态提示删掉。
  - Lab：编辑区夹具加“没有标签：标志与提示”场景（固定样例，点了记事件）。
  - Spec：`workbench/editor.md` 输出 32 的空态、验收 19、合同测试、批准依据；组件文档 `EditorGroup`、`EditorArea`。
  - 验证：`editor/empty-tips.test.ts` 两例在真实内核的命令系统上（三行内容、不可用那行消失、mac 按键、英文；命令不存在那行消失）；编辑器 bun 测试 97 例、组件测试 58 例全过，typecheck 为 0。e2e：`editor-area` 纸面一例改为检查标志居中与 132px、三行文字与按键，点“显示所有命令”打开命令面板、点“打开欢迎页”打开欢迎页；`settings` 的语言切换改用提示行的文字观察；编辑区、设置、欢迎页、Lab 编辑器与场景门禁共 27 例全过。`lab:shot` 空态场景在 nbook、macos × 明暗 × free、phone 下问题 0 条。变异 6 处抓到 5 处（不可用的也显示、不写位置、编辑区不转交点击、插件不给提示、标志不定大小）；存活的“mac 也按加号拆”说明那个分支是多余的（mac 的写法本来没有加号），已删掉。
  - 另开 Task：面板拖动手势归 [t82](../t82-panel-gestures/README.md)；视图与容器拖放的落点指示与动画、标题栏宽度自适应与多级菜单对照旧应用，归 [t83](../t83-legacy-parity-dnd-titlebar/README.md)。这几条都不是 t79 改出来的。

## 下一步

按 plan.md 第二轮的 S6–S10 实现（待开发者确认计划），S11 收口：第一轮 omp 审查意见、第二轮切片的 omp 审查、e2e 全套两轮，之后关闭 Task。
