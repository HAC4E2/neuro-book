# t77 实施计划：书架打磨二

## Context

- **为什么做**：开发者 2026-10-11 看过 t76 的书架后提出：
  - “新建作品”按钮太小；
  - 字段旁的 ⓘ 是手画的圆圈字母，不好看；
  - 取色要做成通用组件，现在的外观不好；
  - “放在哪里”太口语，输入框与“浏览…”不一样高；
  - 新建窗口左下方空；
  - 新建窗口应当居中、不能拖、点空白处关闭；
  - `Dialog` 与 `DialogWindow` 两套几乎相同的样式不要维护两处；
  - z-index 要集中维护。
  
  另有 t74 审查 C7：状态栏字数每次输入都全文重算。
- **开发者已确认**（2026-10-11，全部按推荐）：
  - 卡片网格末尾与列表末行加“新建作品”占位，工具栏按钮保留；
  - nb-ui 新增 `InfoTip`（图标加 Tooltip）替换手画的 ⓘ；
  - nb-ui 新增色板组件，`ColorPicker` 面板改用 reka 的取色原语重做，去掉原生取色控件；
  - 文案改“保存位置”，输入框与按钮同一档高度；主题色挪到左栏封面下面；
  - `Dialog` 合并 `DialogWindow`：缺省模态，可选浮动窗口，`DialogWindow` 这个名字取消；
  - 作品信息对话框改为模态，没改过时点空白处关闭，改过之后点空白不关；
  - 目录选择器也改为模态，从新建窗口里打开时叠在上面；
  - 打开时焦点给书名；
  - 字数是精确值，输入时停手 300ms 再算，按修订号缓存。
- **开发者随后确认**：z-index 规则化并进 S2；旧应用不留兼容，接受它从此不能运行（见文末）。
- **依据**：
  - [书架页](../../../../../docs/specs/workbench/bookshelf.md) 输出 6、8、11–13；
  - [编辑器](../../../../../docs/specs/workbench/editor.md) 输出 27；
  - nb-ui [设计语言](../../../../../packages/nb-ui/docs/design-language.md)（坑 #32：头尾细线平时不画）与 [UI 开发规范](../../../../../packages/nb-ui/docs/ui-development-spec.md)；
  - [测试规范](../../../../../docs/testing/README.md)（nb-ui 共享组件取证：两个主题、两种配色，外加 390 宽）。
- **工作方式**：
  - worktree `.worktree/w00017-runtime-foundation`，每片自跑验证后单独提交、推送备份；
  - S1 是静态稿：做出组件与 Lab 场景，截图给开发者看，确认后再提交并做后面的片；
  - 测试用真实组件、真实浏览器，时间相关的用注入时钟，不用 mock、spy、假计时器、固定等待；核心逻辑做变异检查；
  - 计划经 opus 子代理审查（必须先改 4 条、建议 10 条，均已改进本稿）；收口时交 omp 做实现审查，非阻塞。

## 关键设计

### 对话框：`packages/nb-ui/src/components/feedback/Dialog.vue`

一个组件，两种用法，外观只写一处。

**底座与可访问性**
- 底座是 reka 的 `DialogRoot`（`:modal`）、`DialogPortal`、`DialogContent`、`DialogTitle`。
- 传送目标沿用 `useTeleportTarget`，Lab 里收进画布。
- 不再使用手写的焦点锁定。`utils/focus-trap.ts` 是 `./utils` 的公开导出，保留不删。
- 总是渲染 `DialogTitle`：
  - 自定义 `header` 插槽时，包在 `DialogTitle as="div"` 里；
  - 没有标题时，渲染一个只给读屏的标题（文字取 `title`，空时用“对话框”）。
- `DialogContent` 缺省传 `aria-describedby="undefined"`。缺标题或描述时 reka 会打控制台警告，而 `lab-scenes.e2e.ts` 要求零警告。

**两种用法的接口**

现有 `Dialog` 的 props、emits、slots 与缺省值全部不变，两种用法共用同一套缺省值。下表只列两边含义不同或只在一边生效的项。

| 项 | 模态（`modal` 缺省 true） | 非模态（`modal=false`） |
|---|---|---|
| 位置 | 居中 | 打开时居中，标题栏可拖动，约束在视口内 |
| 遮罩 | reka `DialogOverlay`，按 `overlayType` 画；`transparent` 时也渲染 | 没有 |
| `closeOnOverlay` | 生效：按下与松开都在遮罩上才算一次点击 | 不适用 |
| `closeOnEsc` | 只关最上层 | 只关最上层 |
| `resizable`、`minWidth`、`minHeight`，`update:width`、`update:height` | 不适用 | 生效，行为同现在的 `DialogWindow.md` |
| `width` | `string`，或数字（按 `min(Npx, calc(100cqw - 32px))` 收窄） | 同左；拖动与缩放按渲染后的实际尺寸夹紧 |
| `request-close` 的原因 | `overlay`、`cancel`、`close-button`、`esc` | `cancel`、`close-button`、`esc` |
| `initialFocus?: string`（新增） | 按选择器在正文里找初始焦点；没给时是第一个可聚焦元素；给了但找不到时聚焦面板 | 同左 |

非模态窗口要关闭按钮、不要缺省页脚时，由使用方显式传 `closable`、`:show-footer="false"`。合并后它在产品里没有使用者。

**外框**
- 标题左对齐，有 `header` / `header-extra` 插槽和可选关闭按钮（sm），正文是滚动的拥有者。
- 页脚的缺省按钮改用 nb-ui `Button`。
- 分隔线两种用法一致：平时不画，正文滚动后标题下方或页脚上方才出现（坑 #32）。
- 面统一用 `nb-ui-popover-surface nb-ui-dialog-surface nb-ui-surface-rim`。`DialogWindow` 自己的毛玻璃窗体删掉，`styles.css` 里“刻意不同、各自维护”的例外说明同步删去。

**模态的细节**
- 遮罩必须用 reka 的 `DialogOverlay`。reka 模态会把 body 设为 `pointer-events: none`，普通 `div` 遮罩收不到指针事件；只有 `DialogOverlay` 带 `pointer-events: auto` 和滚动锁。
- “按下与松开都在遮罩上”由我们在 `DialogOverlay` 上处理 pointerdown 与 pointerup。同时在 reka 的 `pointer-down-outside`、`interact-outside` 里 `preventDefault`，不用 reka 自己的外部点击关闭。reka 会在下一刻检查 `defaultPrevented`，这个做法可行。
- 遮罩按下时，如果对话框里还有浮层开着（下拉、取色面板），只关浮层，不关对话框。判定办法：按下那一刻最上层的 reka 图层不是本对话框的内容。
- Escape 经 reka 的 `escape-key-down`，以下两种情况 `preventDefault`，不关闭：
  - 正在用输入法组字（`isComposing`）；
  - 原始按键事件已经被内层控件处理过（`defaultPrevented`）。
- 焦点锁定、背景不可交互、关闭后焦点还给打开前的元素，都交给 reka。
- **Lab 的宿主上下文**：`useTeleportTarget` 的宿主上下文加一项 `contained`，Lab 画布提供为 true。为 true 时，模态在画布内画遮罩、居中，但以 reka 的非模态方式挂载：不锁 body、不把 Lab 外壳设为 `aria-hidden`、不锁焦点。这样模态场景开着时，Lab 的检视栏与控制区仍可用。这是宿主提供的能力，不是测试分支。`AlertDialog`、`Drawer` 现有的同样问题不在本 Task 处理。

**非模态的细节**
- `DialogWindow` 的定位、标题栏拖动、六个缩放手柄、视口约束、嵌套深度，搬进 `composables/useFloatingWindow.ts`。
- 行为与现在的 `DialogWindow.md` 一致：没有遮罩，点外面不关。

**层级**（`theme/z-index.ts`）
- 同时打开的模态按打开顺序叠放：模块级维护已打开的模态列表，第 i 个（从 0 起）取 `dialog + i × NB_DIALOG_Z_STEP`（步长 2），最多 5 层，占 9000–9009。
- 模态向内容树提供的 `NB_POPOVER_Z_INDEX` 是一个固定值：`dialog + 5 × 步长`，即 9010。高于所有模态层、低于通知。
  - 理由：注入在 setup 时就要给出，而打开顺序要到打开时才知道；现有消费方都把它当数字用（`Menubar`、`TimePickerDefault`、`useDropdownSurfaceStyle` 等），不改成响应式。
  - 代价：下层对话框的浮层在上层对话框打开时仍开着，就会盖住上层。点“浏览…”之类的按钮之前，外部点击已经把浮层关了，所以实际不会出现。写进 `Dialog.md` 的限制。
- 非模态窗口保持现有的按深度分档（8990–8999），向内容提供“自己的层级 + 1”。
- `notification` 从 9001 挪到 9050，不被叠起来的模态盖住。
- 现在的模态 `Dialog` 没有提供 `NB_POPOVER_Z_INDEX`，放在里面的 Tooltip、下拉、取色面板会落在 60、70 层，压在对话框下面（已读代码确认）。合并后两种用法都提供。
- Lab 画布本身是一个 z-index 20 的层叠上下文，会掩盖这类层级缺陷，所以层级只在产品页的 e2e 里验收。

**`AlertDialog`**
- 仍用 reka 的 `AlertDialog`：角色是 alertdialog，只能二选一，不能点外面关。
- 标题与页脚改用和 `Dialog` 同一组基座类：`styles.css` 新增 `.nb-ui-dialog-title`、`.nb-ui-dialog-footer`。
- 层级取同一个模态序列。

**已知限制**，写进 `Dialog.md`：
- 模态开着时，reka 会把通知视口设为 `aria-hidden`，读屏不播报新通知。
- 自己用 Teleport 实现的 `TimePickerDefault` 放进模态，收不到指针。
- 文档标签补上 `state:inject`，并说明那份模块级的模态列表。

**不变量**
- 编辑器的关闭确认、资源管理器的三个对话框（未保存复制、显示、重名），现有测试与 e2e 原样通过。资源管理器 e2e 要求“打开时第一个输入框得到焦点”，reka 的缺省自动聚焦能满足。
- Esc 只关最上层；关闭后焦点回到打开前的元素。

### 层级登记与规则

- **数值只在 `theme/z-index.ts` 一处**。以下四处整页层级的字面量登记进去，或按含义引用已有的档：
  - 工作台拖动反馈 `WorkbenchDragFeedback.vue` 的 1000；
  - `DropFeedbackOverlay.vue` 的 60；
  - Lab 检查框 `HighlightBox.vue` 的 `z-50`；
  - 离线横幅 `web/styles.css` 的 2147483000：它刻意在最顶层，保留数值，加注释说明。
- **`ui-development-spec.md` 加一节“层级”**，只写规则，不写数字：
  - 各档从低到高的含义；
  - 组件内部的局部叠放（`z-10` 这类）可以写字面量，固定定位或传送出去的整页浮层必须从登记表取；
  - 三条动态规则：窗口按嵌套深度、模态按打开顺序、容器向内容提供浮层层级；
  - 链接到 `z-index.ts`。
  
  同时删掉第 263 行写死的错误数字（写的是 9300，实际是 9000）。
- **nb-ui 加测试**：
  - 各档顺序与区间不重叠（例如模态 5 层不碰到容器浮层档和通知）；
  - 组件里不允许出现大于 50 的 z-index 字面量，只能写在 `z-index.ts`。与 `token-consumption.test.ts` 同一类扫描。

### 说明图标：`packages/nb-ui/src/components/feedback/InfoTip.vue`（新）

- props：`text: string`、`label?: string`（可访问名称，缺省“说明”）、`placement?`（缺省 top）。
- 外观：一个 `<button type="button">`，里面是 lucide `circle-help` 图标，14px，平时 `--text-muted`，悬停变 `--text-main`；点击区 18px，用 `nb-ui-focus-ring`。外面包 `Tooltip`。
- 能用 Tab 聚焦。是不是初始焦点由所在对话框的 `initialFocus` 决定。

### 取色：`packages/nb-ui/src/components/form/`

**`ColorPickerPanel.vue`（新，内部组件，不从入口导出）**

只有面板，没有触发器，`ColorPicker` 与 `ColorSwatches` 都用它，避免两者互相引用。从上到下：
- 饱和度与明度面：`ColorAreaRoot`，显式设 `colorSpace="hsb"`、x 轴饱和度、y 轴明度（reka 缺省是 hsl 加色相）；
- 色相条：`ColorSlider`；
- 颜色值输入：`ColorField`；
- 预设色板：可选。

内部状态用 reka 的 `Color` 对象，经 `update:color` 传递，不用 hex 来回转换，否则饱和度或明度为 0 时色相会丢。对外发出的值去掉 alpha，统一为小写 `#rrggbb`，与作品身份文件的颜色格式一致（`PROJECT_COLOR_PATTERN`）。

**`ColorPicker.vue`（改）**
- 对外接口保留 `modelValue`、`defaultValue`、`disabled`、`readonly`、`swatches`、`size`；删去模板从未用过的 `showInput`。
- 触发器不变，弹层里换成 `ColorPickerPanel`。
- 去掉原生 `<input type="color">` 与“完成”按钮，点外面或 Escape 关闭。

**`ColorSwatches.vue`（新）**
- 单选的一组色块。props：
  - `modelValue: string | null`、`colors: string[]`；
  - `autoLabel?: string` 与 `autoColor?: string`：给了 `autoLabel` 就在最前面加“自动”色块，选中时值为 null。色块画 `autoColor`（任意 CSS 颜色，由使用方算），加一个小标记。组件里不写字面色，不需要 token 扫描的豁免；
  - `customLabel?: string`：给了就在末尾加“自定义”色块，点它在旁边打开 `ColorPickerPanel`（reka `Popover`）。当前值不在 `colors` 里且不为 null 时，这个色块显示该颜色并处于选中；
  - `columns?: number`、`size?: "sm" | "md"`、`disabled`。
- emits：`update:modelValue(string | null)`。
- 底座是 reka 的 `ColorSwatchPicker`（它其实是 Listbox）：
  - `selectionBehavior` 设为 `replace`，否则再点一次已选的色块会取消选中；
  - “自动”“自定义”用哨兵值；“自定义”的选中事件取消掉，改为打开面板；
  - 每个色块的可访问名称用中文标签或色值，覆盖缺省的英文颜色名；
  - 键盘只用左右方向键（Listbox 横排时上下键无效），写进 `.md`。

### 作品信息对话框：`packages/neuro-book/src/plugins/projects/web/components/ProjectInfoDialog.vue`（由 `ProjectInfoWindow.vue` 改名）

- **容器**：模态 `Dialog`，`width` 700（数字，按视口收窄），没有右上角关闭按钮（页脚有“取消”）。
- **关闭规则**：
  - `request-close` 的原因是 `overlay` 且表单改过时，忽略；其余原因照常取消；
  - “改过”指书名、简介、主题色、保存位置与封面任一与打开时不同。
- **初始焦点**：书名。id 给书名那个 `FormField` 的 `for`：`FormInput` 的显式 id 会盖过 `FormField` 的，标签就关联不上了；`initialFocus` 按这个 id 找。
- **布局**：
  - 左栏：封面（150 × 225）、“上传封面… / 更换封面… / 移除封面”、主题色（标签加 `InfoTip`，下面 `ColorSwatches` 两行五列：自动、八色、自定义；`autoColor` 取封面现在用的那个自动色）；
  - 右栏：书名、简介、保存位置（只在新建时）。简介的输入框占满右栏剩余高度，两栏底部对齐；
  - 编辑模式没有保存位置，简介同样撑满。
- **保存位置**：标签“保存位置”加 `InfoTip`；`FormInput` 与“浏览…”按钮都用缺省档高度；文件夹名后缀照旧。
- **其余**：
  - 所有 ⓘ 换成 `InfoTip`，删掉手画的 `.project-info__info`；
  - props、emits 不变；
  - 色板的测试选择器改为按色块上的 `data-project-swatch` 找（角色从 radiogroup 变为 listbox）；
  - `BookshelfHost.vue` 与 Lab 夹具（`fixtures/index.ts` 的引用与组件名）跟着改。

### 目录选择器：`packages/neuro-book/src/plugins/projects/web/components/PathPickerDialog.vue`

- 模态 `Dialog`，`width` 640，居中，点空白处关闭。
- 标题用 `title`，`InfoTip` 放进 `header-extra`，不再用 `#header` 插槽。
- `initialFocus` 给列表。列表在加载完之前还不存在，这时聚焦面板；加载完由现有逻辑把焦点交给列表，不会落到 `InfoTip` 上弹出提示。
- 从作品信息对话框的“浏览…”打开时叠在它上面：Esc 和点遮罩只关选择器，关闭后焦点回到“浏览…”。

### 新建占位：`ShelfCards.vue`、`ShelfList.vue`

- **卡片视图**：有作品时，在最后一张卡后面放一张“新建作品”占位，样式就是空书架那张“待写的书”：加号封面位、“新建作品”、一句说明、底行写作品目录。点它发 `create`。
- **结构**：
  - 外层网格容器带 `data-shelf-grid`；
  - 列表框元素改为 `display: contents`，`role="listbox"`、`aria-*`、`tabindex`、`data-shelf-cards` 都留在它身上，书卡是它的子元素；
  - 占位卡是它的兄弟，带 `data-shelf-create-card`，不复用 `data-shelf-create`，避免 e2e 的选择器同时命中两个。
- **键盘**：方向键只在书卡之间移动，列数仍按书卡的位置算。Tab 顺序：列表框 → 各卡的“更多”按钮（平时透明，但能 Tab 到） → 占位卡。
- **列表视图**：末尾多一行“新建作品”，封面位是加号，带 `data-shelf-create-row`，不用 `data-shelf-row`（测试按它数行，`focusShelf` 按它找第一行）。
- **空书架**照旧是两张待写卡。工具栏按钮保留。Lab 夹具里 `ShelfList` 场景的事件补上 `create`。
- **S1 先在真实 Chrome 里做一次小实验**：`display: contents` 的列表框能否拿到焦点、`aria-activedescendant` 是否生效、无障碍树里角色是否还在。不行时退路是“占位卡在网格下面另起一行”，这偏离了“网格末尾”的决定，要先问开发者。

### 字数：`packages/neuro-book/src/plugins/editor/web/status-items.ts`

- `editorStatusItems` 多接一个注入时钟（`clockKey`，编辑器浏览器入口已依赖它；接口 `schedule(callback, ms)` 返回取消函数）。
- 缓存是 `WeakMap<文档, {revision, count}>`，文档对象在打开期间不变。只缓存文档已就绪时算出的值。
- **立即算**：活动文档换了，或者该文档还没有可用的缓存（包括新开文件读到正文的那一刻）。这样新开文件不会先闪“0 字”，切到在后台被磁盘改过的文档也直接显示新值。
- **延后算**：同一个活动文档的修订号变了（也就是在输入），先显示缓存里的值，用时钟排一个 300ms 的计算，到点按当时的修订号算。
  - 计时器按“待算的修订号”管理：修订号变了才重排，同一修订号不重排；
  - 状态栏每次求值会把所有条目的 `text()` 都调一遍（移动光标也会），不能每次调用都重排。
- 一个 `shallowRef` 计数器在算完后加一，让条目文字重新求值。算法不变（`shared/word-count.ts`）。

## Spec 与文档改动

Spec 在实现的那一片里改，不提前写成现状。

| 片 | 文档 | 改什么 |
|---|---|---|
| S1 | `docs/specs/workbench/bookshelf.md` | 输出 6（列表框之后的占位卡、Tab 顺序）与输出 8（列表末行）；验收追加 8（点占位卡打开新建） |
| S2 | `docs/specs/workbench/bookshelf.md` | 输出 11–13：模态、关闭规则、初始焦点、新布局与“保存位置”、目录选择器可叠放。正文不写组件名，删掉现在写的 `DialogWindow`。验收追加 9（没改过点空白关闭、改过不关；叠放时 Esc 只关选择器）。“验收与 Smoke”“证据”两节里的 `ProjectInfoWindow` 改名 |
| S3 | `docs/specs/workbench/editor.md` | 输出 27：“正文变化后在下一帧更新”改为“输入时停手 300ms 后更新，打开或切换文档时立即显示”；验收追加 16 |
| S2 | `docs/proposals/bookshelf.md` | 决策记录追加 2026-10-11：作品信息与选择器改为模态、占位卡 |
| S1 | nb-ui 组件文档 | 新增 `InfoTip.md`、`ColorSwatches.md`、`ColorPickerPanel.md`；`ColorPicker.md` 改面板；nb-ui `README.md` 登记 |
| S2 | nb-ui 组件文档与规范 | `Dialog.md` 重写（两种用法对照表、层级与叠放、Lab 的 `contained`、已知限制）；删 `DialogWindow.md`；九个组件 `.vue` 注释与 `.md` 里“由 DialogWindow 注入”的说明改为 `Dialog`（Tooltip、Popover、HoverCard、Dropdown、FormSelect、Autocomplete、DatePicker、DateRangePicker、TimePicker、Menubar、ColorPicker 及 `useDropdownSurfaceStyle.ts`）；`ui-development-spec.md` 第 13 节、Tier 4（第 262 行起）与新的“层级”一节；`design-language.md` 第 63、245、601、626 行；`styles.css` 第 137、240 行；nb-ui `README.md` 第 60、107、143 行与 `docs/README.md` |
| S1、S2 | 作品组件文档 | `ProjectInfoDialog.md`（改名）、`PathPickerDialog.md`、`ShelfCards.md`、`ShelfList.md` |

## 切片

| 片 | 内容 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | 计划（已经 opus 子代理审查并修订）、Task 登记 | 计划、README | `docs:check`、`governance:check` |
| S1 | 静态稿：`InfoTip`、`ColorPickerPanel`、`ColorSwatches`、新取色面板（真组件、`.md`、测试、Lab 场景）；作品信息新排版（暂留在 `DialogWindow` 上，它已注入浮层层级）；占位卡与列表末行（真实现，含聚焦小实验）。截图给开发者，确认后提交 | nb-ui 新组件、两个书架组件、Spec 输出 6、8 | nb-ui `test`、`typecheck`、`build:css`；`lab:shot`（nbook、macos 两个主题 × 明暗，1280 与 390）；`ShelfCards`、`ShelfList` 的 DOM 测试；`bookshelf.e2e.ts` |
| S2 | `Dialog` 合并（reka 底座、外框、模态叠放、浮层层级、Lab 的 `contained`、非模态 composable）；删 `DialogWindow` 并同步全部引用；`AlertDialog` 共用基座类；层级登记与规则；同一片里把作品信息对话框与目录选择器迁到模态，中间不留坏掉的提交 | nb-ui、Lab 夹具与 e2e、书架组件、Spec 输出 11–13 | nb-ui `test`、`typecheck`、`build:css`；neuro-book `typecheck`、vitest、`bun test`；`lab:shot` 的 Dialog 各场景（两个主题 × 明暗，390）；e2e：`editor-area`、`files-explorer`、`lab-nb-ui`、`lab-scenes`、`lab`、`bookshelf`、`bookshelf-stats` |
| S3 | 字数：打开或切换时立即算，输入时停手后再算 | 编辑器、Spec 输出 27 | `status-items.test.ts`；`editor-area.e2e.ts` |
| S4 | 收口：`test:affected --typecheck --since <t77 起点>`、全量 `test:e2e`、`docs:check`、`governance:check`、核心逻辑的变异检查、omp 实现审查、README、回写建议 | 证据与文档 | 同左 |

## 验收映射

| 编号 | 覆盖 |
|---|---|
| `workbench.bookshelf` 输出 6、8，验收 8 | `ShelfCards.dom.test.ts`、`ShelfList.dom.test.ts`；`BookshelfPage.dom.test.ts`（`focusShelf` 仍落在列表框）；`bookshelf.e2e.ts`（点占位卡打开新建，列表框仍能拿到焦点） |
| `workbench.bookshelf` 输出 11、13，验收 3、9 | `ProjectInfoDialog.dom.test.ts`（关闭规则、初始焦点与标签关联、保存位置）；`bookshelf.e2e.ts`（在产品页：新建、没改过点空白关闭、改过点空白不关、取色面板显示在对话框之上并能拖色相条） |
| `workbench.bookshelf` 输出 12，验收 7、9 | `PathPickerDialog.dom.test.ts`；`bookshelf.e2e.ts`（从新建对话框叠开选择器，Esc 与点遮罩只关选择器，焦点回到“浏览…”） |
| `workbench.editor` 输出 27，验收 13、16 | `status-items.test.ts`（`ManualClock`：输入后到点之前显示旧值，到点更新；切换文档、新开文件立即显示正确值）；`editor-area.e2e.ts` 现有字数用例 |
| nb-ui `Dialog`（组件文档） | `Dialog.test.ts`（两种用法、遮罩判定、Esc 只关最上层、组字时 Esc 不关、叠放层级、内容浮层层级、初始焦点与找不到时聚焦面板、焦点归还）；`lab-nb-ui.e2e.ts` 的窗口用例改到 `Dialog` 的非模态场景；Lab 画布对话框用例（场景 24） |
| nb-ui `InfoTip`、`ColorSwatches`、`ColorPickerPanel`、`ColorPicker` | 各自的测试；`lab:shot` |
| 层级规则 | 新的 nb-ui 层级测试 |

## 验证

- 每片按上表自跑；nb-ui 有改动时跑 `build:css` 并提交产物（`dist-css.test.ts` 会拦）。
- 层级与“点空白”只以产品页 e2e 为准，原因有两个：
  - Lab 画布是一个 z-index 20 的层叠上下文，会掩盖层级缺陷；
  - Lab 的落点会把指针事件强制恢复，模态遮罩的问题在 Lab 里看不出来。
- 真实浏览器要亲眼看并写进 e2e 的：
  - 叠放的两层遮罩；
  - Esc 与点遮罩只关上层；
  - 对话框里的取色面板与下拉在对话框之上；
  - 占位卡与书卡同一行排布、Tab 顺序；
  - 390 宽下没有横向溢出。
- 收口跑全量 `test:e2e`。对核心逻辑做变异检查：遮罩判定、Esc 判定、叠放层级、关闭规则、字数的立即与延后。
- 未验证的边界：读屏软件实际朗读（只核对 Chrome 的无障碍树）。

## 不做与风险

- **不做**：
  - 通知的去重与数量上限；
  - `Banner` 的使用者；
  - 品牌色进主题；
  - `settings/commands.test.ts` 的既有失败；
  - `AlertDialog`、`Drawer` 在 Lab 里同样会锁住外壳的问题。
- **风险**：
  - **`Dialog` 换成 reka 底座**会改变现有使用者的焦点细节。以它们现有的测试与 e2e 原样通过为准，不改测试迁就实现。
  - **列表框设为 `display: contents`**：能否聚焦、角色是否保留，在 S1 的小实验里定。
  - **`ColorSwatchPicker` 的 Listbox 语义**：上下方向键不能用，“自定义”要取消选中再开面板。实验不顺就改用 reka 的 `RadioGroup`，外观与接口不变。
  - **模态内容的浮层层级是固定值**：下层对话框的浮层在上层打开时仍开着就会盖住上层。正常操作碰不到，写进限制。

## 开发者的确认（2026-10-11）

1. 同意 z-index 规则化，并进 S2 做（见“层级登记与规则”）。
2. 旧应用选 (a)：接受 `packages/neuro-book-legacy` 从此只能读代码、不能运行。它有 16 个文件引用 `DialogWindow`，nb-ui 不留兼容薄壳，旧应用不改。
