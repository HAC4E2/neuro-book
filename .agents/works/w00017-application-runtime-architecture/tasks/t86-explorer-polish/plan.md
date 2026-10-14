# t86 实施计划：资源管理器打磨

## Context

- **为什么做**：开发者 2026-10-14 要求打磨工作台左侧的资源管理器，并试用 nbdev 流程。三轮评审板（[artifacts/review](artifacts/review/index.html)）定下的决定见 [Task README 的“决定”](README.md#决定)，本计划只落实这些决定。
- **依据**：[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md)、[`workspace/folder-kinds.md`](../../../../../docs/specs/workspace/folder-kinds.md)、[`workspace/files.md`](../../../../../docs/specs/workspace/files.md)、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)、[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)；组件文档 `ExplorerRow`、`ExplorerTree`、`FilesExplorerView`，nb-ui `ContextMenu`。
- **不在本 Task**：搜索与过滤框（[t88](../t88-search-plugin/README.md)）、从系统拖入文件（[t87](../t87-explorer-os-import/README.md)）、标题动作、章节字数、配色设置项。
- **工作方式**：worktree `.worktree/w00017-t86-explorer-polish`（分支 `feat/w00017-t86-explorer-polish`）。每片自跑验证后单独提交，只暂存本片文件；开发服务经 `nbdev dev start`，截图经 `nbdev shot`。测试用真实内核与真实 Files，不用 mock；时间相关的用注入时钟。不改 `packages/neuro-book-legacy`。

## 关键设计

### 1. 排序与节点的“叶子”标记（`src/plugins/files/backend/`）

- **中文数字排序**：`folder-kinds.ts` 的 `compareNames` 先把名字里“第 + 中文数字 + 卷 / 章 / 回 / 节 / 部 / 集 / 篇 / 幕 / 话”中的中文数字换成阿拉伯数字作比较键（零、〇、一到九、两、十、百、千、万），再交给现有的 `Intl.Collator("zh-CN", {numeric: true})`；比较键相等时仍按原名的码元次序，保持全序。阿拉伯数字本来就按数值比。只影响普通文件夹与内容文件夹的未列入项（两处都走 `compareEntries`）；清单顺序与活页夹不变。
- **叶子节点**：内容树里的目录项加可选字段 `leaf: true`，表示目录里除了 `index.md` 没有别的项（列出该层时对每个节点目录读一次目录；现在判断 `body` 已经对每个节点目录访问一次磁盘，开销同量级）。`EntrySchema` 加 `leaf: Type.Optional(Type.Boolean())`；可选字段，按 Files 合同的版本规则判断是否升版本（`body` 加入时的做法为准）。普通目录不给这个字段：空的普通文件夹仍可展开，展开后什么也不显示。
- **绝对路径**：Files 客户端加只读方法 `realPath(address) → string`（服务端的磁盘绝对路径），给“复制路径”用；`user://` 同样可用。不在浏览器里拼路径。

### 2. 文件图标（新目录 `src/plugins/explorer/web/icons/`）

- **素材**：`@iconify-json/catppuccin`（MIT）作 devDependency，只在生成脚本里读。生成脚本 `scripts/gen-file-icons.ts` 按映射表挑出用到的图标（约 25 个），把 SVG 里 catppuccin Macchiato 的 16 种颜色换成 CSS 变量 `var(--file-icon-<色名>)`，写成 `icons/catppuccin.ts`（文件头写来源、版本与 MIT 许可声明）。不把 659 个图标打进前端。
- **配色**：`icons/palette.css` 定义 16 个变量：亮色取 Latte，`[data-nb-appearance="dark"]` 下取 Macchiato（按色名一一对应）。Lab 的画布同样带这个属性。
- **映射**：`icons/file-icons.ts` 是纯函数 `fileIconOf(row) → 图标名`：文件按扩展名（Markdown、文本、JSON、YAML、XML、图片、PDF、CSV、压缩包，其余用通用文件）；目录按种类（普通、内容文件夹、活页夹各一个，展开与收起各一个），少数常见目录名（`图片`、`images`、`插图`、`资料`、`docs`）用对应的文件夹图标；节点行有正文用 Markdown，没有用内容文件夹；根行仍用现在的 lucide 图标。
- **组件**：`FileIcon.vue`（同名 `.md`）画内联 SVG（16px），只读 props；内联才能让变量随明暗变化（UnoCSS 的图标是 mask 或 data URI，进不了变量）。

### 3. 行的样子（`web/tree/rows.ts`、`web/components/ExplorerRow.vue`、`ExplorerTree.vue`）

- **状态挂在行上**：`rows.ts` 不再产出 `status` 行（除内联输入的 `edit` 行外只有根行与资源行）。目录行加 `problem: {kind: "loading" | "error" | "manifest", code, detail} | null`：读取中把箭头换成转圈；读取失败名字用 `--status-danger`、行尾错误标记，点标记或右键“重试”（新命令 `nbook.files.retry-list`，参数 `{}`，作用于焦点行）；清单不合法名字用 `--status-warning`、行尾警告标记；空目录展开后不显示任何行。原因进行的 `title` 与 `aria-description`，标记是带可访问名称的按钮或图标。
- **短标记改成状态图标**：无正文、缺失、未列入、需要剧情插件、剪切中改为行尾弱化色的 lucide 图标（`file-minus`、`ban`、`circle-dashed`、`puzzle`、`scissors`），悬停经 nb-ui 的提示显示文字；缺失与剪切中的行仍淡化。副标题（真实名字）仍是文字。
- **内容文件夹**：名字去掉 `.content` 后缀，后缀作副标题（与节点的真实名字同一写法）；活页夹同理去 `.binder`。
- **叶子节点**：`leaf` 的节点行不可展开、没有箭头（`expandable: false`），点它只选择或打开正文。
- **两个根**：根行改为分节标题：小一号、加粗、弱化色、不缩进、没有图标，仍是 `treeitem`，键盘与选择不变。
- **缩进参考线**：`ExplorerTree` 给每行按深度画竖线，对齐上级箭头的中线；焦点行（没有焦点时取选中行）所在那一层的连续兄弟段加深。三档由设置决定（第 4 节）：`hover` 时只在树悬停或有焦点时显示；减少动画时不做淡入。
- **隐藏 `.md`**：设置打开时，普通文件与未改展示名的内容项去掉 `.md` 后缀显示；改名框里仍是完整名字，`title` 仍是完整路径。

### 4. 设置项（`src/plugins/explorer/shared/settings.ts`，新文件）

- 用 `defineSetting`（参照 `workbench/shared/contracts.ts` 的 `themeSetting`）登记两项，归新的设置分节“资源管理器”：`nbook.explorer/indentGuides`（`none | hover | always`，缺省 `hover`）、`nbook.explorer/hideMarkdownExtension`（布尔，缺省 `false`）。即时生效。
- 不做配色设置项（第三轮决定）。

### 5. 右键菜单（nb-ui `ContextMenuPanel.vue`、`web/menu.ts`、`web/commands.ts`）

- **nb-ui**：快捷键提示右对齐、用正文字体的弱化色（去掉 `font-mono text-[10px]`）；`--elevation-popover` 在 nbook 与 macos 两个主题里加深一档。所有用 nb-ui 浮层的菜单一起变，`ContextMenu.md` 同步。
- **新命令**（参数 `{}`，作用于选择，Agent `never`）：`nbook.files.open`（Enter，常驻打开）、`nbook.files.open-to-side`（Ctrl/Meta+Enter）、`nbook.files.copy-path`（`realPath`，写系统剪贴板）、`nbook.files.copy-relative-path`（相对所在根）。“打开”“在侧边打开”只对能打开的行出现；目录行没有。
- **编辑器**：`nbook.editor.open` 加可选参数 `group?: string | "side"`：给组 id 时在那一组打开，`"side"` 时在活动组右侧的组打开（没有就向右拆分）。`editor.md` 同步。

### 6. 拖动（`web/actions/drop.ts`、`web/tree-drag.ts`、`ExplorerTree.vue`）

- **落点规则**（`resolveDrop`）：
  - 普通文件夹里的文件行（上下两半）或两行之间：移入这一行所在的文件夹；
  - 树的空白处（最后一行之下）：移入项目根（拖动源都在用户资产根时移入用户资产根）；
  - 内容文件夹里同层两行之间仍是排序；目录行中间仍是移入；
  - 源已在目标文件夹里时没有落点（与现在一致）。
- **落点反馈**：移入时高亮目标文件夹的整个可见范围（目录行与它展开的子行一起画浅底），不画插入线；插入线只留给排序。落点标签跟着指针，不再固定在目标行下方。
- **拖影**：指针右下画一个小浮块，写被拖的名字（多项时“N 项”）；被拖的行淡化。浮块与落点反馈一样经 portal 画在 `body` 上。
- **停留展开**：指针停在收起的目录行中段 600 ms 自动展开（计时用注入的时钟；移开或落点变了就重新计）。
- **边缘滚动**：指针进入树上下边缘 24 px 内时按帧滚动，越近越快；滚动后照现有规则撤下落点再按新位置判定。
- **拖到编辑区**：指针在编辑组（`[data-editor-group]`，编辑器已有的标记，`editor.md` 写明这是给拖放用的公开标记）上时，落点是“在这一组打开”，编辑组画整块浅底；放下执行 `nbook.editor.open {address, mode: "permanent", group}`。多项只打开文件、跳过目录，最多 10 个。这是两个插件经 DOM 标记的约定，不经外壳的拖放会话（外壳的会话只拖视图）。

### 7. Lab 场景与截图（`src/plugins/lab/web/fixtures/`）

- 现有 `ExplorerRow`、`ExplorerTree`、`FilesExplorerView` 场景按新的行补齐：读取中、读取失败、清单不合法、叶子节点、各类图标、参考线三档、隐藏 `.md`、暗色。`FileIcon` 登记场景（全部图标 × 明暗）。
- `live` 场景的内存数据补几种文件类型与叶子节点，契约测试（`lab/memory-files.test.ts`）随之补 `leaf`。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `workbench/files-explorer.md` | “行的样子”：图标、状态挂在行上、状态图标、内容文件夹去后缀、叶子节点、根的分节标题、参考线、隐藏 `.md`；“拖动”：新落点、反馈、拖影、停留展开、边缘滚动、拖到编辑区；命令表加四条与 `retry-list`；设置两项；状态表“正在列出的目录单独显示加载状态”改写；验收新增 21–26；“边界与兼容”里 `explorer/context` 已开放的旧句子顺手更正 |
| `workspace/folder-kinds.md` | 名字排序认“第 N 卷 / 章 …”里的中文数字 |
| `workspace/files.md` | 目录项的 `leaf`；客户端的 `realPath` |
| `workbench/editor.md` | `nbook.editor.open` 的 `group` 参数；`data-editor-group` 是拖放的公开标记 |
| nb-ui `ContextMenu.md`、`ui-development-spec.md` 浮层一节 | 快捷键右对齐、正文字体；阴影 |
| 组件文档 | `ExplorerRow`、`ExplorerTree`、`FilesExplorerView`、新 `FileIcon` |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | 上表的 Spec 与组件文档 | `bun run docs:check`、`bun run governance:check` |
| S1 | 第 1 节 | Files：排序、`leaf`、`realPath` | `bun run --cwd packages/neuro-book typecheck`，files 的 Bun 测试 |
| S2 | 第 2 节 | 图标素材、生成脚本、`FileIcon` | 同上；`bun install` 后锁文件只多 `@iconify-json/catppuccin`；`lab:shot -c FileIcon` |
| S3 | 第 3、4 节 | 行的样子、参考线、设置项 | explorer 的 Bun 与 DOM 测试；`lab:shot` 三个组件 × nbook、macos × 明暗 |
| S4 | 第 5 节 | 右键菜单、新命令、编辑器 `group` | nb-ui 与 neuro-book 的测试；`lab:shot -c ContextMenu` |
| S5 | 第 6 节 | 拖动 | explorer 的 Bun 与 DOM 测试；`files-explorer.e2e.ts` |
| S6 | 第 7 节与收口 | Lab 场景、e2e、截图证据、Spec 证据 | `bun run test:affected --typecheck`，新应用全套 e2e（先 `build:server`、`build:web`、`build:e2e`），`docs:check`、`governance:check` |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| “第二卷”排在“第一卷”后，“第十二章”在“第三章”后；“第12章”与“第十二章”稳定全序 | `files/backend/folder-kinds.test.ts` 增补 |
| 只有正文的节点 `leaf`，有附件或子目录的不是；行不可展开 | files 列出测试（真实磁盘）；`explorer/browse.test.ts` |
| 读取中、读取失败、清单不合法挂在目录行上，没有状态行；失败可经 `retry-list` 重列 | `tree/tree.test.ts`、`ExplorerTree.dom.test.ts`；`browse.test.ts`（真实 Files 制造读失败） |
| 图标按扩展名与目录种类；明暗切换后颜色随变量变 | `icons/file-icons.test.ts`；`lab:shot` 明暗截图 |
| 参考线三档、隐藏 `.md`（改名框仍是完整名字） | `ExplorerTree.dom.test.ts`、`ExplorerRow` 的 DOM 测试；e2e 改设置后的显示 |
| 新菜单项：打开、在侧边打开（新组）、复制路径与相对路径（系统剪贴板内容） | `FilesExplorerActions.dom.test.ts`；`files-explorer.e2e.ts`（剪贴板权限在 Playwright 里授予） |
| 拖到文件上与两行之间移入其父目录；拖到空白移入根；内容文件夹排序不变 | `actions/plan.test.ts` 的 `resolveDrop` 增补；`transfer.test.ts`（真实 Files） |
| 停留 600 ms 展开（注入时钟）、边缘滚动、拖影与源行淡化 | `ExplorerTree.dom.test.ts`；`files-explorer.e2e.ts` 拖动用例 |
| 拖到编辑组在那一组打开 | `files-explorer.e2e.ts` 新增一例（两个编辑组） |

## 验证

- 每片按上表自跑；收口跑 `test:affected --typecheck` 与新应用全套 e2e，e2e 前停掉多余的服务（本机内存紧）。
- 真实浏览器：`nbdev dev start` 起开发服务，用样例作品“雾港”（本地 `.local/…/t86-explorer-polish/sample/`）按评审板的场景逐项截图对照，nbook、macos × 明暗；截图精选进 `evidences/`。
- 实现审查：收口后派一个 opus 子代理按本计划与禁止清单审查一轮，发现逐条处理后再交开发者验收。
- 未验证的边界：触摸设备上的停留展开与边缘滚动只做组件级测试；跨机器访问时“复制路径”给的是服务端机器上的路径（Spec 写明）。

## 不做与风险

- **不做**：过滤框与搜索（t88）、系统拖入（t87）、配色设置项、标题动作、章节字数、根以外的新分节（JetBrains 那样的 Scratch 与第三方库根，等有了这类数据再说）。
- **风险**：
  - 改 `--elevation-popover` 影响所有浮层：S4 对 nb-ui 浮层组件全量 `lab:shot`，有不协调的再收窄到菜单。
  - 去掉状态行改变了现有测试与 e2e 的定位方式（按“空目录”“正在读取”文字找元素的用例要改成按行属性），不能为了让测试通过放宽断言。
  - 拖到编辑区靠 DOM 标记跨插件：编辑器改了标记会悄悄失效；用 e2e 一例守住，并在 `editor.md` 写成公开约定。
  - `leaf` 让列出内容文件夹多一次读目录：S1 用 t72 的 `perf:files` 样本复测展开内容文件夹的耗时，明显变慢就改成懒判断（展开后才去掉箭头）。

---

# 第四轮：拖动的排序、落点指示与动画（2026-10-14 追加）

## Context

验收时开发者要求拖动再设计一轮，第四轮评审板（review v5）定了四件事与一条补充，见 [README 的“决定”第四轮](README.md#决定)。现状的问题：别的层拖到内容文件夹两行之间只能“移入、排在最后”；子树末尾的缝只能进那个节点；插入线横贯整行、带光晕、看不出层级；移入的浅底四边内缩 6px，与行错位、压字；没有放下、取消、新建与删除的动画；拖影离指针远。仍在分支 `feat/w00017-t86-explorer-polish` 上做，接着 S6 编号。

## 关键设计

### 8. 文件服务：移动时放到指定位置（`src/plugins/files/`）

- 合同：`move` 的每一项加可选 `before`（目标那一层另一项的名字），远程合同版本 5；`FilesClient.move` 的 `BatchTransfer` 同步。只对目标在内容树里的移动有意义；目标是普通文件夹时忽略（普通文件夹按名字排序，没有位置）。
- `backend/commit.ts` 的 `move`：插入目标清单时把 `before` 传给已有的 `insert` 编辑（`manifest-edit.ts` 已支持，名字不在这一层时放到末尾）。源与目标在同一层（同目标移动，现在直接返回“无操作”）且带 `before` 时，改为只在清单里把这一项挪到 `before` 之前，仍在同一把操作锁里。这样多选里混着同层与别层的源时，一批按树里的先后逐项插到同一个锚点之前，结果连成一串，每一项各自原子。
- 复制不加位置（这次不需要）。

### 9. 落点规则（`web/actions/drop.ts`、`web/tree-drag.ts`）

- `TreeDragTarget` 的行目标加指针相对行左边的 `x`；`DropOver` 的行落点带上它。
- 把“行的上下段”统一成“缝”：缝在上一行 A 与下一行 B 之间。A 是展开且有子行的目录时，这条缝只有一层（A 的第一个子项之前）；否则可选的层从 `B.depth`（没有 B 时为 1）到 `A.depth`，按 `x` 取 `floor((x - 8) / 12)` 夹在这个范围里（指针在名字上时取最深的一层，往左移变浅）；不能放到第 0 层（根）。层 d 的接收目录是 A 在 d-1 层的祖先，位置是“A 在 d 层的祖先之后”。
- 接收目录在内容树里：源都在这一层 → `reorder`（只改清单，与现在相同）；否则新动作 `place {target, before, line: {after, depth}}`（`before` 取那个位置之后第一个不被拖动的项，没有为 `null` 即放到最后）。接收目录是普通文件夹 → `move`（移入，与现在相同）。
- 目录行中段（含叶子节点、收起的目录、根）仍是移入；内容树里移入放在最后。空白与编辑组不变。
- 控制器：`place` 冻结源后调 `files.move`，每项带 `before`；`sameDrop` 比较 `target`、`before` 与线的位置。

### 10. 反馈（`web/components/ExplorerTree.vue`，新组件 `ExplorerDropIndicator.vue` 与同名 `.md`）

- 插入线与浅底改画在树的行容器里（绝对定位，跟着行滚动，与行左右对齐），不再用 nb-ui 的 `DropFeedbackOverlay`；拖到编辑组的整块浅底仍用它。
- `place` / `reorder`：2px 强调色实线压在缝的正中，起点缩进到落点那一层，左端 8px 空心圆，不带光晕；接收目录的整段（目录行到最后一个子孙）铺 7% 强调色底。
- 移入（`move`）：目标目录整段铺 9% 强调色底，目录行 16%，圆角同行，不描边；画在行的下面，不压字。
- 标签：`放到 X 之后` / `放到 X 之前`（放到第一项时）；换了接收目录时后面加 `（移入 P）`；内容树里移入写 `移入 P（放在最后）`。
- 拖影离指针近一点：左上角放在指针右侧 12px、下方 4px（现在是 14、18），截图确认不挡住指针所指的那一行的名字开头。
- 被拖的行只淡化图标与文字，缩进参考线不淡（现在竖线上会出缺口）。

### 11. 动画（`ExplorerTree.vue`、`ExplorerRow.vue`、`controller.ts`）

时长取主题的 `--motion-fast` / `--motion-base`，系统减少动态效果时它们是 0，全部不放。树是虚拟列表，只对渲染着的行做。

- **结构变化的预告**：控制器在提交移动、放置、调整顺序、粘贴、新建、删除时，先记一份预告 `{moves: [{to, fromIndex}], arrivals: [地址], departures: [地址]}`（`fromIndex` 是提交那一刻源在行列表里的下标），交给树。树在之后的行更新里认出预告里的地址时，在这一次渲染打开与“展开收起”同一套的过渡窗口（现在的 `data-expanding` 推广为 `data-motion`）；一秒内没有认出就丢掉，不让无关的刷新带动画。
- **1 放下后滑到新位置**：`to` 行按 FLIP 从 `fromIndex` 的位置滑到新位置，并短暂铺强调色底再淡去；其余行的 `top` 过渡让位。
- **2 落进看不见的地方**：`to` 行没有渲染（父目录收起）时，最近的渲染着的上级目录行闪一下。
- **3 取消时拖影飞回**：Escape、指针取消或放在没有落点的地方时，拖影从当前位置移到第一个源行再淡出，之后才卸载；源行淡化同时恢复。
- **4 停留展开的进度**：开始计时时目录行的箭头用线性过渡在 600 ms 里转到朝下，计时取消时快速转回；计时到点展开时箭头已在终点，不跳。
- **5 新建、粘贴与删除**：`arrivals` 的行从上方滑入并短暂亮一下，`departures` 的行收起淡出（与展开收起同一套进出过渡）。
- **6 起拖**：拖影挂载时从 0.96 放大到 1 并淡入；源行的淡化用 `--motion-fast` 过渡。

## Spec 与文档改动（S7）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/files-explorer.md` | “拖动”的落点、反馈两条改写为上面第 9、10 节；新增“动画”一条；验收 25 改写，新增 27（内容文件夹跨层放置与子树末尾选层）、28（动画的可观察结果：移动后行在新位置、收起的接收目录被标记、取消后拖影卸载、减少动态效果时没有过渡） |
| `docs/specs/workspace/files.md` | `move` 的 `before` 与同目标带 `before` 的语义；合同版本 5 |
| `docs/specs/workspace/folder-kinds.md` | “经文件服务的操作同步清单”里“放到指定位置”补上移动 |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S7 | Spec 改动表 | 三份 Spec | `docs:check`、`governance:check` |
| S8 | 第 8 节 | Files 合同、`commit.ts`、客户端、Lab 内存适配器 | files 的 Bun 测试；`neuro-book` typecheck |
| S9 | 第 9 节 | 落点规则与控制器 | explorer 的 Bun 测试与 DOM 测试 |
| S10 | 第 10 节 | 反馈组件、标签、拖影位置、源行淡化 | 同上；开发服务截图对照评审板 |
| S11 | 第 11 节 | 动画 | 同上；减少动态效果下再跑一遍 e2e 拖动用例 |
| S12 | — | e2e、收口截图、实现审查与修正 | 资源管理器 e2e；`test:affected --typecheck --since master`；全套 e2e |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 移动带 `before`：插到指定位置；同层带 `before` 只挪清单；混合多选连成一串；普通文件夹忽略；锁与事件不变 | `files` 的服务测试（真实磁盘） |
| 缝的选层：展开目录的第一个子项之前只有一层；子树末尾按 `x` 选层；不能到根层；同层 `reorder`、跨层 `place`、普通文件夹 `move` | `actions/plan.test.ts` 的 `resolveDrop` |
| 内容文件夹跨层放置后清单顺序与磁盘位置都对；子树末尾靠左放到节点之后 | `files-explorer.e2e.ts` 新增（真实 Files 与 Chrome） |
| 插入线缩进到落点那一层、接收目录铺底、移入的底与行对齐 | DOM 测试按 `data-*` 与内联几何断言；开发服务截图对照 |
| 放下后 `to` 行带过渡标记、收起的接收目录被标记、取消后拖影在过渡后卸载、减少动态效果时不打标记 | `ExplorerTree.dom.test.ts`（等可观察的标记，不用假计时器）与 e2e 一例 |

## 验证与风险

- 真实浏览器：开发服务里的雾港（`人物.content` 已加“港务局”等），按评审板的四个场景截图，nbook、macos × 明暗。动画录一段短视频（Playwright 录像）放本地，挑关键帧进 `evidences/`。
- 收口派一个 opus 子代理审查一轮，逐条处理后再交验收。
- **风险**：FLIP 依赖“提交时的下标”与“刷新后的下标”属于同一棵树，期间别的刷新插进来会让起点偏一点，只影响动画，不影响结果；一秒内认不出就丢掉。按 `x` 选层在很深的嵌套里可选的层多，靠缩进的线与标签说明，不另加提示。
