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
