# VS Code Explorer 视觉与交互细节调研

调研方法：对 `microsoft/vscode` 做浅克隆 + sparse-checkout（`--filter=blob:none --sparse`），拉取 tag **`1.141.1`**（commit `7baac39ec3ca969dab74ac12c097f6a486e46593`，2026-10-14 时 `git ls-remote --tags` 返回的最新稳定 tag）。下文每条结论标注文件路径与关键代码，均为源码直接确认；标"推断"的例外说明。

---

## 结论先行

1. **滚动条**：鼠标进入整个列表视口（`SmoothScrollableElement` 的根节点，覆盖行内容区 + 滚动条自身）或发生滚动/拖动时，`ScrollbarVisibilityController` 把 class 从 `invisible` 切到 `visible`；离开后用 `500ms` 延时再切回 `invisible fade`。淡入 `opacity 0→1` 用 `100ms linear`，淡出用 `800ms linear`（`invisible.fade` 才有这条 transition，普通 `invisible` 无过渡）。滑块宽度默认 `10px`（track 和 slider 同宽，无内缩），Explorer 未覆盖这个默认值。轨道背景色默认未注册（`null`），即无背景色，只有滑块本身可见。
2. **标题栏动作按钮**：按 `ViewPane` 自己的 pane-header（`.pane-header > .actions`）走 CSS `:hover` / `:focus-within` 门控，默认隐藏，鼠标进入**整个 pane**（标题 + 内容区）或键盘焦点落入 pane 内都会显示；有配置项 `workbench.view.alwaysShowHeaderActions`（默认 `false`）可强制常显。但当视图与容器合并（侧栏顶部 "EXPLORER" 那一整行，`isViewMergedWithContainer()===true`）时，动作按钮改走 `compositePart.ts` / `paneCompositePart.ts` 渲染的 `.title-actions`，这条路径**没有** hover/focus 门控 CSS，`display: flex` 永远可见——这与分视图 pane-header 不是同一触发源，是两套完全独立的显示逻辑。
3. **选中/焦点/悬停行样式**：所有背景色规则都直接作用在 `.monaco-list-row`（`width: 100%`，无缩进、无右边距、无 `border-radius`），因此背景横贯整行；滚动条是绝对定位的覆盖层，不占布局空间，行背景会延伸到滚动条下面。`list.activeSelectionBackground`（DOM 焦点在列表内）与 `list.inactiveSelectionBackground`（焦点不在列表内但仍选中）是两套不同的 CSS 选择器（`:focus` 前缀与否）。关闭编辑器（含关闭最后一个）**不会**清除 Explorer 的选中态：`selectActiveFile()` 只在 `activeFile` 为真值时才调用 `select()`，没有活动编辑器时直接什么都不做，之前选中的行原样保留——此时因为焦点通常不在 tree 上，会显示 `inactiveSelectionBackground`（灰色）而非 `activeSelectionBackground`（蓝色）。
4. **内联重命名/新建输入框**：`InputBox` 占满一整行（`flex:1; width:100%`），行高固定 `22px`（Linux/Mac 显式设置，Windows 走默认），内部 `.input` 高度 `20px` 内边距 `0`；聚焦态用 1px `outline`（`focusBorder` 颜色，`outline-offset: -1px`），没有传统 `border`。默认选中范围是"不含扩展名的主文件名"（`{start:0, end:lastDot}`），目录则全选；再按 `F2` 在"主文件名→全选→扩展名"三态间循环。校验失败的提示是一个通过 `contextViewProvider` 定位在输入框下方、宽度与输入框相同的浮层，`1px solid` 错误色边框 + 对应背景色，不是原生 tooltip。

---

## 问题 1：滚动条的半透明与"仅悬停/滚动时显示"

### 显示/隐藏状态机

`src/vs/base/browser/ui/scrollbar/scrollbarVisibilityController.ts`：

```ts
private _reveal(): void {
	if (this._isVisible) return;
	this._isVisible = true;
	// The CSS animation doesn't play otherwise
	this._revealTimer.setIfNotSet(() => {
		this._domNode?.setClassName(this._visibleClassName);
	}, 0);
}

private _hide(withFadeAway: boolean): void {
	this._revealTimer.cancel();
	if (!this._isVisible) return;
	this._isVisible = false;
	this._domNode?.setClassName(this._invisibleClassName + (withFadeAway ? ' fade' : ''));
}
```

构造时类名为 `'visible scrollbar ' + extraClass` / `'invisible scrollbar ' + extraClass`（见 `abstractScrollbar.ts:66`）。

### 触发源：谁能让滚动条 reveal

`src/vs/base/browser/ui/scrollbar/scrollableElement.ts`：

```ts
const HIDE_TIMEOUT = 500;
...
this._listenOnDomNode = this._options.listenOnDomNode || this._domNode;
...
this.onmouseover(this._listenOnDomNode, (e) => this._onMouseOver(e));
this.onmouseleave(this._listenOnDomNode, (e) => this._onMouseLeave(e));
...
private _onMouseOver(e: IMouseEvent): void {
	this._mouseIsOver = true;
	this._reveal();
}
private _onMouseLeave(e: IMouseEvent): void {
	this._mouseIsOver = false;
	this._hide();
}
private _reveal(): void {
	this._verticalScrollbar.beginReveal();
	this._horizontalScrollbar.beginReveal();
	this._scheduleHide();
}
private _scheduleHide(): void {
	if (!this._mouseIsOver && !this._isDragging) {
		this._hideTimeout.cancelAndSet(() => this._hide(), HIDE_TIMEOUT);
	}
}
```

`_listenOnDomNode` 默认就是 `this._domNode`——也就是整个 `.monaco-scrollable-element` 包装节点（内容 `rowsContainer` + 两条滚动条本身都在它内部），List 没有传 `listenOnDomNode`（`src/vs/base/browser/ui/list/listView.ts:438` 的 `SmoothScrollableElement` 构造没有这个 key），所以**鼠标进入列表任意一行内容区域就会触发显示**，不需要精确悬停在滚动条窄条上。另外：

- 滚动本身（`_onDidScroll`）：`if (this._revealOnScroll) { this._reveal(); }`（`_revealOnScroll` 默认 `true`）。
- 拖动滑块：`_onDragStart()` → `this._isDragging = true; this._reveal();`，拖动中 `_hide()`/`_scheduleHide()` 内的 `!this._isDragging` 判断会跳过隐藏，松开才真正进入 500ms 倒计时。

离开后的隐藏延时就是常量 `HIDE_TIMEOUT = 500`（毫秒）。

### 淡入淡出 CSS

`src/vs/base/browser/ui/scrollbar/media/scrollbars.css`：

```css
.monaco-scrollable-element > .visible {
	opacity: 1;
	background:rgba(0,0,0,0); /* IE9 兼容，允许点击 */
	transition: opacity 100ms linear;
	z-index: 11;
}
.monaco-scrollable-element > .invisible {
	opacity: 0;
	pointer-events: none;
}
.monaco-scrollable-element > .invisible.fade {
	transition: opacity 800ms linear;
}
.disable-animations .monaco-scrollable-element > .visible,
.disable-animations .monaco-scrollable-element > .invisible.fade {
	transition: none;
}
```

即：显示时 `100ms linear` 淡入；隐藏时（内容仍需要滚动条，`withFadeAway=true`）`800ms linear` 淡出；若内容不再需要滚动条（`isNeeded` 变 `false`），`_hide(false)` 不带 `fade` class，没有过渡，直接消失。`disable-animations`（对应"减少动画"设置）会把两条 transition 都清零。

### 轨道、滑块颜色与宽度

同一文件：

```css
.monaco-scrollable-element > .scrollbar {
	background: var(--vscode-scrollbar-background);
}
.monaco-scrollable-element > .scrollbar > .slider {
	background: var(--vscode-scrollbarSlider-background);
}
.monaco-scrollable-element > .scrollbar > .slider:hover {
	background: var(--vscode-scrollbarSlider-hoverBackground);
}
.monaco-scrollable-element > .scrollbar > .slider.active {
	background: var(--vscode-scrollbarSlider-activeBackground);
}
```

默认色值，`src/vs/platform/theme/common/colors/miscColors.ts`：

```ts
export const scrollbarShadow = registerColor('scrollbar.shadow',
	{ dark: '#000000', light: '#DDDDDD', hcDark: null, hcLight: null }, ...);
export const scrollbarSliderBackground = registerColor('scrollbarSlider.background',
	{ dark: Color.fromHex('#797979').transparent(0.4), light: Color.fromHex('#646464').transparent(0.4), ... }, ...);
export const scrollbarSliderHoverBackground = registerColor('scrollbarSlider.hoverBackground',
	{ dark: Color.fromHex('#646464').transparent(0.7), light: Color.fromHex('#646464').transparent(0.7), ... }, ...);
export const scrollbarSliderActiveBackground = registerColor('scrollbarSlider.activeBackground',
	{ dark: Color.fromHex('#BFBFBF').transparent(0.4), light: Color.fromHex('#000000').transparent(0.6), ... }, ...);
export const scrollbarBackground = registerColor('scrollbar.background',
	null, ...); // 轨道背景：无默认值，即透明/不渲染
```

这是颜色**注册表**的基础默认值，实际还要看当前主题是否覆盖：

- `extensions/theme-defaults/themes/dark_modern.json`、`light_modern.json`：**都没有**覆盖任何 `scrollbarSlider.*` / `scrollbar.*`，即 Dark Modern / Light Modern 直接沿用上面的注册表默认值（`#797979`/`#646464` 透明度 0.4/0.4/0.7/0.4 等）。
- 本次拉到的仓库里实际默认主题已经是更新的 **`Dark 2026` / `Light 2026`**（`extensions/theme-defaults/package.json` 中 `id: "Dark 2026"`/`"Light 2026"`），它们显式覆盖了这组颜色：
  ```json
  // 2026-dark.json
  "scrollbar.shadow": "#191B1D4D",
  "scrollbarSlider.background": "#A8A9AA85",
  "scrollbarSlider.hoverBackground": "#A8A9AA90",
  "scrollbarSlider.activeBackground": "#A8A9AA9C",
  ```
  ```json
  // 2026-light.json
  "scrollbar.shadow": "#00000000",
  "scrollbarSlider.background": "#646464C0",
  "scrollbarSlider.hoverBackground": "#646464D0",
  "scrollbarSlider.activeBackground": "#646464E0",
  ```
  这组值整体更不透明（alpha 更高），说明较新版本把滑块调得更清晰可见。两套数值都是源码直接确认；具体哪个是"当前真正生效的默认主题"（`workbench.colorTheme` 的默认取值）没能在本次 sparse-checkout 范围内直接定位到配置项，这点标记为推断——但从 `package.json` 里 `Dark 2026`/`Light 2026` 排在列表最前、且带有新编号这一事实看，大概率是新的出厂默认。

宽度默认值，`src/vs/base/browser/ui/scrollbar/scrollableElement.ts`：

```ts
export const DEFAULT_SCROLLBAR_SIZE = 10;
let globalDefaultScrollbarSize = DEFAULT_SCROLLBAR_SIZE;
```

List 构造 `SmoothScrollableElement` 时没有传 `verticalScrollbarSize`/`horizontalScrollbarSize`（`src/vs/base/browser/ui/list/listView.ts:438-446`），所以 Explorer 树用的是这个全局默认 `10px`，滑块与轨道同宽，没有额外内缩。

阴影（`scrollbar.shadow`，用于顶部/左侧"已滚动"提示，不是滚动条本身）：List 默认 `useShadows: true`（`listView.ts` `DefaultOptions.useShadows = true`），Explorer 未覆盖，因此继承。

---

## 问题 2：视图标题栏动作按钮随鼠标显示

### 分视图 pane-header（多个视图堆叠时，每个视图自己的标题行）

`src/vs/workbench/browser/parts/views/viewPane.ts`：

```ts
export enum ViewPaneShowActions {
	/** Show the actions when the view is hovered. This is the default behavior. */
	Default,
	/** Always shows the actions when the view is expanded */
	WhenExpanded,
	/** Always shows the actions */
	Always,
}
...
private static readonly AlwaysShowActionsConfig = 'workbench.view.alwaysShowHeaderActions';
...
private updateActionsVisibility(): void {
	if (!this.headerContainer) return;
	const shouldAlwaysShowActions = this.configurationService.getValue<boolean>('workbench.view.alwaysShowHeaderActions');
	this.headerContainer.classList.toggle('actions-always-visible', shouldAlwaysShowActions);
}
```

配置项默认值，`src/vs/workbench/browser/workbench.contribution.ts:709-713`：

```ts
'workbench.view.alwaysShowHeaderActions': {
	'type': 'boolean',
	'default': false,
	'description': "Controls the visibility of view header actions. ..."
},
```

真正的显示门控在 CSS，`src/vs/base/browser/ui/splitview/paneview.css`：

```css
/* TODO: actions should be part of the pane, but they aren't yet */
.monaco-pane-view .pane > .pane-header > .actions {
	display: none;
	margin-left: auto;
	margin-right: 8px;
}

.monaco-pane-view .pane:hover > .pane-header.expanded > .actions,
.monaco-pane-view .pane:focus-within > .pane-header.expanded > .actions,
.monaco-pane-view .pane > .pane-header.actions-always-visible.expanded > .actions,
.monaco-pane-view .pane > .pane-header.focused.expanded > .actions {
	display: initial;
}
```

四条选择器精确回答"显示条件是什么"：

1. `.pane:hover`——鼠标悬停在**整个 `.pane` 元素**上（header + body 都算，不是只悬停标题行）；
2. `.pane:focus-within`——pane 内任意子元素拿到 DOM 焦点（声明式写法）；
3. `.pane-header.actions-always-visible`——即 `workbench.view.alwaysShowHeaderActions=true` 时常显；
4. `.pane-header.focused`——命令式写法，`src/vs/base/browser/ui/splitview/paneview.ts:268-269`：
   ```ts
   this._register(focusTracker.onDidFocus(() => this.header?.classList.add('focused'), null));
   this._register(focusTracker.onDidBlur(() => this.header?.classList.remove('focused'), null));
   ```
   `focusTracker` 跟踪的是整个 pane（而不只是 header），所以第 2、4 条本质是同一信号的 CSS 声明式/JS 命令式双重实现，键盘把焦点移进列表行也会点亮这组按钮。

另外要求 `.expanded`：折叠状态的 pane 即使悬停也不显示动作按钮（因为折叠时内容不可见，动作本就无意义）。

### 单视图合并进容器标题栏（"EXPLORER" 那一整行）

`src/vs/workbench/browser/parts/views/viewPaneContainer.ts`：

```ts
isViewMergedWithContainer(): boolean {
	if (!(this.options.mergeViewWithContainerWhenSingleView && this.paneItems.length === 1)) {
		return false;
	}
	...
}
```

只有容器里**只剩一个可见视图**（例如用户把 Open Editors / Outline / Timeline 都隐藏掉，只留 Explorer 本体）才会合并；Explorer 默认视图容器注册了多个视图，日常情况下 `paneItems.length > 1`，所以这条路径默认不触发，"EXPLORER" 大标题就是容器自己的标题，不是某个 pane 的 header。

合并发生时，容器把动作转发给唯一的视图（`getActionViewItem` / `getActionsContext`，`viewPaneContainer.ts:582-592`），但**渲染位置变了**：容器级标题栏由 `compositePart.ts` 渲染：

```ts
// src/vs/workbench/browser/parts/compositePart.ts:405-421
protected override createTitleArea(parent: HTMLElement): HTMLElement | undefined {
	...
	const titleActionsContainer = append(titleArea, $('.title-actions'));
	this.toolBar = this._register(this.instantiationService.createInstance(WorkbenchToolBar, titleActionsContainer, { ... }));
	...
}
```

对应 CSS，`src/vs/workbench/browser/parts/media/compositepart.css`：

```css
.monaco-workbench .part > .composite.header-or-footer,
.monaco-workbench .part > .composite.title {
	display: flex;
}
.monaco-workbench .part > .composite.title > .title-actions {
	flex: 1;
	padding-left: 8px;
}
```

在整个 `src/vs/workbench/` 范围内搜索 `title-actions`（含 `compositepart.css`、`paneCompositePart.css`、`views.css`），**没有任何一条规则给它加 `:hover` / `:focus-within` 门控**——都是 `display: flex` 常驻。换句话说：

> 合并到容器标题栏时，动作按钮**永远可见**，不随鼠标隐藏；只有未合并、各自保留 pane-header 的分视图才会按问题里描述的"鼠标进入才显示"。两者是两套独立实现（`paneview.css` vs `compositepart.css`/`paneCompositePart.css`），不是同一触发源在起作用。

### 与滚动条是否同一触发区域

不是。滚动条的显示由 `ScrollableElement` 内部的 `onmouseover`/`onmouseleave` 绑定在 `_listenOnDomNode`（List 的内容滚动容器本身）上触发（见问题 1）；pane-header 动作按钮由 `paneview.ts` 里对整个 `.pane` 元素做 `trackFocus`/原生 `:hover` 伪类触发。两者监听的 DOM 范围不同：滚动条只关心"内容滚动区"，pane-header 动作关心"整个 pane"（包含标题行本身，标题行并不在滚动容器内）。鼠标放在标题行上只会显示动作按钮、不会唤出滚动条；鼠标放在列表行上两者都会被触发（列表行同时在"pane 内" 和 "滚动容器内"）。

---

## 问题 3：选中/焦点/悬停行样式

### 颜色与默认值

`src/vs/platform/theme/common/colors/listColors.ts`：

```ts
export const listFocusOutline = registerColor('list.focusOutline',
	{ dark: focusBorder, light: focusBorder, hcDark: activeContrastBorder, hcLight: activeContrastBorder }, ...);
export const listFocusAndSelectionOutline = registerColor('list.focusAndSelectionOutline', null, ...);
export const listActiveSelectionBackground = registerColor('list.activeSelectionBackground',
	{ dark: '#04395E', light: '#0060C0', hcDark: null, hcLight: Color.fromHex('#0F4A85').transparent(0.1) }, ...);
export const listActiveSelectionForeground = registerColor('list.activeSelectionForeground',
	{ dark: Color.white, light: Color.white, hcDark: null, hcLight: null }, ...);
export const listInactiveSelectionBackground = registerColor('list.inactiveSelectionBackground',
	{ dark: '#37373D', light: '#E4E6F1', hcDark: null, hcLight: Color.fromHex('#0F4A85').transparent(0.1) }, ...);
export const listInactiveFocusOutline = registerColor('list.inactiveFocusOutline', null, ...); // 无默认值，不画框
export const listHoverBackground = registerColor('list.hoverBackground',
	{ dark: '#2A2D2E', light: '#F0F0F0', hcDark: Color.white.transparent(0.1), hcLight: Color.fromHex('#0F4A85').transparent(0.1) }, ...);
```

`focusBorder` 基础默认值，`src/vs/platform/theme/common/colors/baseColors.ts:37`：没有硬编码色值（取决于主题），各主题里的实际值：

| 主题 | `focusBorder`（= `list.focusOutline`，未单独覆盖时） | `list.activeSelectionBackground` | `list.inactiveSelectionBackground` | `list.hoverBackground` |
|---|---|---|---|---|
| 注册表基础默认（无主题覆盖时兜底） | — | dark `#04395E` / light `#0060C0` | dark `#37373D` / light `#E4E6F1` | dark `#2A2D2E` / light `#F0F0F0` |
| Dark Modern（`dark_modern.json`） | `#0078D4`（未单独覆盖 `list.*`，整份文件搜不到任何 `list.` key） | 同注册表默认 `#04395E` | 同注册表默认 `#37373D` | 同注册表默认 `#2A2D2E` |
| Light Modern（`light_modern.json`） | `#005FB8`（`focusBorder` 显式设置，`list.focusAndSelectionOutline` 也显式设为 `#005FB8`） | 显式覆盖为 `#E8E8E8`（比基础默认的蓝色 `#0060C0` 浅得多，接近灰色） | 未覆盖，沿用 `#E4E6F1` | 显式覆盖为 `#F2F2F2` |
| Dark 2026（本仓库当前列在首位的新默认主题，`2026-dark.json`） | `#3994BCB3`（同 `list.focusOutline`） | `#FFFFFF22`（白色叠加 13% 透明度，而不是传统的实色深蓝） | `#2C2D2E` | `#FFFFFF14` |
| Light 2026（`2026-light.json`） | `#0069CC` | `#00000025` | `#DADADA99` | `#00000014` |

可以看到较新的 `2026-dark`/`2026-light` 主题把选中/悬停背景从"实色"改成了"黑/白叠加半透明"的方案（类似 macOS/新 Fluent 风格的半透明高亮），这是与传统 Dark Modern/Light Modern 实色方案的明显差异点，供 NeuroBook 参考时可以二选一。

### 背景是否横贯整行、DOM 结构

`src/vs/base/browser/ui/list/list.css`：

```css
.monaco-list-row {
	position: absolute;
	box-sizing: border-box;
	overflow: hidden;
	width: 100%;
}
```

`src/vs/base/browser/ui/list/listWidget.ts`（主题样式注入，节选）：

```ts
content.push(`.monaco-list${suffix}:focus .monaco-list-row.focused { background-color: ${styles.listFocusBackground}; }`);
content.push(`.monaco-list${suffix}:focus .monaco-list-row.selected { background-color: ${styles.listActiveSelectionBackground}; }`);
content.push(`.monaco-list${suffix} .monaco-list-row.selected { background-color: ${styles.listInactiveSelectionBackground}; }`); // 无 :focus 前缀
content.push(`.monaco-list${suffix}:not(.drop-target):not(.dragging) .monaco-list-row${hover}:not(.selected):not(.focused) { background-color: ${styles.listHoverBackground}; }`);
content.push(`.monaco-list${suffix}:focus .monaco-list-row.focused { outline: 1px solid ${styles.listFocusOutline}; outline-offset: -1px; }`);
```

- 所有背景色规则的选择器都是 `.monaco-list-row` 本身（不是其子元素如 `.monaco-tl-row`），而 `.monaco-list-row` 的 CSS 宽度是 `100%`——整条规则链里**没有任何地方给它加左右 margin、padding 或 `border-radius`**，所以背景天然横贯整行，不留缩进、不留右边距、无圆角。树形缩进（triangle/图标偏移）是靠行内子元素 `.monaco-tl-indent`/`.monaco-tl-twistie` 的内部布局实现的，不影响最外层 `.monaco-list-row` 的宽度和背景范围。
- `list.activeSelectionBackground` 对应 `.monaco-list:focus .monaco-list-row.selected`（**列表 DOM 本身**要有焦点）；`list.inactiveSelectionBackground` 对应没有 `:focus` 前缀的 `.monaco-list .monaco-list-row.selected`——这是"选中但列表未聚焦"的样式，二者是完全不同的 CSS 规则，不是同一条规则靠透明度区分。
- 滚动条下方是否仍有背景：滚动条 `position: absolute`（`abstractScrollbar.ts:70` `this.domNode.setPosition('absolute')`），不占用布局空间，`.monaco-list-row` 的 `width: 100%` 是相对父容器 `.monaco-list-rows`（同样 `width: 100%`）算的，滚动条是覆盖在内容之上的浮层，所以行背景在视觉上会延伸到滚动条底下，只是滚动条可见时（半透明滑块）盖在上面。

### 关闭编辑器后 Explorer 的选中状态

`src/vs/workbench/contrib/files/browser/views/explorerView.ts`：

```ts
this._register(this.editorService.onDidActiveEditorChange(() => {
	this.selectActiveFile();
}));
...
private async selectActiveFile(reveal = this._autoReveal): Promise<void> {
	if (this._autoReveal) {
		const activeFile = EditorResourceAccessor.getCanonicalUri(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (activeFile) {
			const focus = this.tree.getFocus();
			const selection = this.tree.getSelection();
			if (focus.length === 1 && ... && selection.length === 1 && ...) {
				return; // 已经选中，不动
			}
			return this.explorerService.select(activeFile, reveal);
		}
	}
	// activeFile 为空（没有活动编辑器）时：函数直接结束，什么都不做
}
```

`explorer.autoReveal` 默认值，`src/vs/workbench/contrib/files/browser/files.contribution.ts:444-448`：`'default': true`。

关键结论：当用户关闭最后一个编辑器，`editorService.activeEditor` 变为 `undefined`，`activeFile` 因此是 `undefined`（falsy），`if (activeFile)` 分支整体跳过——**不会**调用 `explorerService.select(undefined, ...)` 去清空选中。所以 Explorer 树里之前对应已关闭文件的那一行**仍然保持"已选中"状态**，没有被清除。因为此时 DOM 焦点通常不在 Explorer 树上（关闭操作发生在编辑器区域），该行会呈现为 `inactiveSelectionBackground`（灰色: dark `#37373D` / light `#E4E6F1`），而不是 `activeSelectionBackground`（蓝色）。只有用户手动把焦点移开/清空选择（或代码路径里显式 `this.tree.setSelection([])`，例如 `selectResource` 在 `item === this.tree.getInput()` 时会这么做，针对的是"选中了根目录自己"的特殊情形，并非关闭编辑器触发）才会真正清空选中高亮。

---

## 问题 4：内联新建/改名输入框

`src/vs/workbench/contrib/files/browser/views/explorerViewer.ts`，`FilesRenderer.renderInputBox`：

```ts
const inputBox = new InputBox(label.element, this.contextViewService, {
	validationOptions: {
		validation: (value) => {
			const message = editableData.validationMessage(value);
			if (!message || message.severity !== Severity.Error) return null;
			return { content: message.content, formatContent: true, type: MessageType.ERROR };
		}
	},
	ariaLabel: localize('fileInputAriaLabel', "Type file name. Press Enter to confirm or Escape to cancel."),
	inputBoxStyles: defaultInputBoxStyles,
});

const lastDot = value.lastIndexOf('.');
let currentSelectionState = 'prefix';

inputBox.value = value;
inputBox.focus();
inputBox.select({ start: 0, end: lastDot > 0 && !stat.isDirectory ? lastDot : value.length });
```

- 默认选中范围：文件名有扩展名时选中 `[0, lastDot)`（即不含扩展名的主文件名部分）；目录，或文件名没有 `.`（`lastDot <= 0`）时，选中全部 `value.length`。
- `F2` 键在编辑态内可以循环切换选中范围（同一文件内再按 F2，不是重新进入改名模式）：
  ```ts
  if (e.equals(KeyCode.F2)) {
  	const dotIndex = inputBox.value.lastIndexOf('.');
  	if (stat.isDirectory || dotIndex === -1) return;
  	if (currentSelectionState === 'prefix') { currentSelectionState = 'all'; inputBox.select({ start: 0, end: inputBox.value.length }); }
  	else if (currentSelectionState === 'all') { currentSelectionState = 'suffix'; inputBox.select({ start: dotIndex + 1, end: inputBox.value.length }); }
  	else { currentSelectionState = 'prefix'; inputBox.select({ start: 0, end: dotIndex }); }
  }
  ```
  即"主文件名 → 全选 → 仅扩展名 → 回到主文件名"三态循环。
- `Enter` 提交前会先 `inputBox.validate()`；`Escape` 取消（`done(false, true)`）。

DOM / CSS，`src/vs/workbench/contrib/files/browser/media/explorerviewlet.css`：

```css
.explorer-folders-view .explorer-item,
.explorer-folders-view .editor-group {
	height: 22px;
	line-height: 22px;
}
.explorer-folders-view .explorer-item .monaco-inputbox {
	width: 100%;
	line-height: normal;
}
.monaco-workbench.linux .explorer-folders-view .explorer-item .monaco-inputbox,
.monaco-workbench.mac .explorer-folders-view .explorer-item .monaco-inputbox {
	height: 22px;
}
.monaco-workbench .explorer-folders-view .explorer-item .monaco-inputbox > .ibwrapper > .input {
	padding: 0;
	height: 20px;
}
.monaco-workbench .explorer-folders-view .explorer-item .monaco-inputbox input[type="text"] {
	outline-width: 1px;
	outline-style: solid;
	outline-offset: -1px;
	outline-color: var(--vscode-focusBorder);
	opacity: 1;
	...
}
```

- 行高固定 `22px`（和普通 Explorer 行一致），输入框 `width: 100%`（`flex: 1` 配合父级 `display: flex`）撑满整行，不留右侧空白。
- 边框不是传统 `border`，而是 `outline`（`1px solid`，颜色取 `--vscode-focusBorder`，`outline-offset: -1px` 让轮廓线画在元素内侧而不占额外空间）。
- 原标签（图标 + 文件名文本）在编辑态被隐藏（`label.element.firstElementChild.style.display = 'none'`），但 `FileLabel` 仍用来渲染左侧文件/文件夹图标（`labelOptions.hideLabel: true` 只隐藏文字，图标还在），所以编辑态输入框左边是带图标的。

校验失败提示浮层，`src/vs/base/browser/ui/inputbox/inputBox.ts` `_showMessage`：

```ts
this.contextViewProvider.showContextView({
	getAnchor: () => this.element,
	anchorAlignment: AnchorAlignment.RIGHT,
	render: (container) => {
		div = dom.append(container, $('.monaco-inputbox-container'));
		div.style.width = dom.getTotalWidth(this.element) + 'px'; // 宽度与输入框一致
		const spanElement = $('span.monaco-inputbox-message');
		...
		spanElement.style.backgroundColor = styles.background ?? '';
		spanElement.style.color = styles.foreground ?? '';
		spanElement.style.border = styles.border ? `1px solid ${styles.border}` : '';
		dom.append(div, spanElement);
	},
	...
});
```

默认错误态颜色（同文件靠前处）：

```ts
inputValidationErrorBorder: '#BE1100',
inputValidationErrorBackground: '#5A1D1D',
```

即：校验失败的提示是通过 `IContextViewProvider` 定位渲染的一个独立浮层（不是输入框自带的 `title`/原生 tooltip），锚点是输入框本身，宽度强制等于输入框宽度，`1px solid #BE1100` 边框 + `#5A1D1D` 背景（暗色主题默认值），默认出现在输入框下方（`contextView` 的默认锚定行为，`anchorAlignment: RIGHT` 只决定水平对齐到右边，不影响垂直方向在下方展开——这部分垂直定位逻辑在 `contextview.ts`，本次未纳入 sparse-checkout 范围，这一点标记为推断，但符合实际使用体验）。

---

## 对 NeuroBook 的建议（可直接套用的参数）

| 项目 | 建议值 / 做法 | 出处 |
|---|---|---|
| 滚动条宽度 | 轨道与滑块同宽 `10px`，无内缩，无轨道背景色（透明），只画滑块 | `scrollableElement.ts: DEFAULT_SCROLLBAR_SIZE = 10`；`scrollbarBackground: null` |
| 滑块颜色/透明度（偏传统方案） | 深色 `#797979` alpha 0.4（常态）/ `#646464` alpha 0.7（hover）/ `#BFBFBF` alpha 0.4（active）；浅色 `#646464` alpha 0.4/0.7，active 用 `#000000` alpha 0.6 | `miscColors.ts` |
| 滑块颜色/透明度（偏新方案，更不透明、更"实"） | 深色 `#A8A9AA` alpha ≈0.52/0.56/0.61（常态/hover/active）；浅色 `#646464` alpha ≈0.75/0.82/0.88 | `2026-dark.json` / `2026-light.json` |
| 显示触发区域 | 绑定在整个滚动容器（内容区 + 滚动条自身），不是窄条本身；滚动、拖滑块同样触发 | `scrollableElement.ts` `_listenOnDomNode` 默认 = 整个 `.monaco-scrollable-element` |
| 淡入/淡出时长 | 进入时 `100ms linear`；离开后先等 `500ms` 再 `800ms linear` 淡出；内容不再需要滚动条时直接消失不淡出 | `scrollbars.css`；`HIDE_TIMEOUT = 500` |
| 标题栏动作按钮显示触发区域 | 如果视图各自保留标题行（分视图场景），门控在整个视图面板（标题+内容）的 `:hover`/`:focus-within`，不是只悬停标题；提供"常显"开关（默认关） | `paneview.css`；`workbench.view.alwaysShowHeaderActions` 默认 `false` |
| 标题栏动作按钮（容器级标题，如只有一个资源管理器视图合并进顶部标题行时） | 不要做 hover 门控，直接常显——这是 VS Code 自己两套实现里"合并态"选的方案 | `compositepart.css` 无 hover 规则 |
| 行背景范围 | 背景色规则直接打在最外层行节点上，不加左右 margin/padding/border-radius，天然横贯整行；滚动条是覆盖层，不占布局宽度，行背景应延伸到滚动条底下 | `list.css` `.monaco-list-row { width:100% }`；`listWidget.ts` 样式注入 |
| 选中态要分两种 | "列表有 DOM 焦点时选中" 和 "选中但列表失焦" 必须是两套不同颜色（不要用同一色加透明度敷衍），后者更淡 | `listActiveSelectionBackground` vs `listInactiveSelectionBackground` |
| 关闭编辑器后的选中行为 | 不要自动清空 Explorer 的选中项；只在用户主动清空/选中根节点等极少数路径才清空。配合"失焦态"配色，关闭编辑器后该行自然变灰而不是消失选中框 | `explorerView.ts selectActiveFile()`：`activeFile` 为空时直接 return，不调用 `select()` |
| 输入框样式 | 占满整行宽度，行高与普通行一致（22px），内部留白极小（`padding:0; height:20px`），用 `outline`（`focusBorder` 色，`offset:-1px`）代替传统 `border` | `explorerviewlet.css` |
| 改名默认选中范围 | 默认选中"去掉扩展名的主文件名"，目录/无扩展名文件选中全部；提供一个重复触发改名快捷键时可在"主文件名/全选/仅扩展名"间循环的交互（锦上添花，非必需） | `explorerViewer.ts renderInputBox` |
| 校验失败提示 | 用浮层（宽度=输入框宽度，锚定输入框下方），不要用原生 `title`；默认给错误态一个边框色+背景色的组合（如 `#BE1100` 边框 / `#5A1D1D` 背景，暗色下） | `inputBox.ts _showMessage` / 默认样式常量 |
