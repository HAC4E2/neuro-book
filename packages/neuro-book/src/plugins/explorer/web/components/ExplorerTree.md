---
标签: [state:local, env:global, env:portal, env:timer]
别名: ["文件树", "File Tree"]
---

# ExplorerTree

资源管理器的虚拟树（[`workbench/files-explorer.md`](../../../../../../../docs/specs/workbench/files-explorer.md) 的“焦点”与验收 1、3）：几千行的目录只渲染视口内的行与上下各 10 行余量，焦点行滚出视口也保持挂载。键盘焦点留在树的列表元素上，当前行经 `aria-activedescendant` 指出；按键交给宿主的 `handleKey` 决定，宿主处理了才阻止默认行为，宿主要求开菜单时在焦点行下方发出 `row-context`。正在内联输入的行与焦点行一样保持挂载。nb-ui 的 `FileTree` 单选、行高 32px、没有虚拟化，所以这里另写。

## 布局

占满父容器的高度，自己是滚动容器（视图 `layout: "fill"`），细滚动条、`scrollbar-gutter: stable`。缩进参考线（[`workbench/files-explorer.md`](../../../../../../../docs/specs/workbench/files-explorer.md) 的“行的样子”）由各行自己画，树决定显隐与加深哪一段：根上 `data-guides` 是 `indentGuides` 的档位，`always`，或 `hover` 时鼠标在树上、树里有焦点，给后代 `--explorer-guide-opacity: 1`；加深的是焦点行（没有焦点时取第一个选中行）连续的同层兄弟那一段（中间更深的行也算）上级的那一层，焦点在根或根的直接子项上时不加深。行左右离边的距离取视图外框给的 `--view-inset-inline`（nbook 是 6px，见 `WorkbenchViewFrame.md`），悬停与选中的底色是圆角块，块边与别的视图的内容边对齐。行高取主题的 `--control-h-sm`（能装下 `FormInput` 的 `sm` 与焦点框）：一个隐藏的探针元素量出它，主题或字号变了随之重算，并按滚动锚点换算滚动位置，阅读位置停在同一资源上。视口高度用布局盒测量；视图停放时尺寸为零，不改记住的滚动位置。滚动锚点是首个可见行的地址与行内偏移：前方插入或删除行时阅读位置不跳；内容变短时夹到合法范围。

## 交互

- 点行：选择与打开交给宿主（带 Ctrl/Meta、Shift 修饰）；点展开箭头只展开收起；双击以常驻方式打开；右键交出行与坐标。
- 按下行时把焦点放到树上（不滚动），之后的按键都在树上处理；行里的按钮与输入框的按键不交给 `handleKey`。
- 焦点换了一行（键盘移动）先滚入视口再更新 `aria-activedescendant`；开始内联输入时输入行同样滚入视口。按行 id 的变化触发：前方插入或删除行只改变下标，阅读位置由滚动锚点保持，不被拉回焦点行。
- Shift+F10 与 ContextMenu 键经 `handleKey` 返回要开菜单的行，树按那一行的位置发出 `row-context`。
- 树获得与失去焦点时发出 `focus-change`。
- 展开与收起的动画（[`workbench/files-explorer.md`](../../../../../../../docs/specs/workbench/files-explorer.md) 的“行的样子”）：展开的目录集合变了之后的一个 `--motion-base`（另加 100ms 余量）里根上打 `data-expanding`，只在这时新出现的行从上方滑下一行高并淡入、离开的行反向、其余行的位置过渡（`TransitionGroup`，名字 `explorer-row`）；滚动时窗口两端进出的行不动画。`--motion-base` 为 0（系统减少动画）时不打。
- 拖动（手势在 `web/tree-drag.ts`，[`workbench/files-explorer.md`](../../../../../../../docs/specs/workbench/files-explorer.md) 的“拖动”）：在资源行上按下，鼠标与笔移动 6px、触摸按住 200ms 后经 `startDrag` 问宿主能不能拖；能拖时捕获指针，每帧把指针下的落点经 `drag-hover` 交出：一行与它在行里的位置（目录行上中下三段、其余行上下两半）、树里行以外的空白，或树外的编辑组（`[data-editor-group]`）。宿主算出动作后经 `drag` 传回，树按它画落点反馈（nb-ui `DropFeedbackOverlay`）：移入画目标目录与它展开的子行那一整段，调整顺序画插入线，在编辑组打开画整个编辑组。指针右下有一个拖影（`body` 上），写被拖的名字（多项写“N 项”）与动作；被拖的行淡化（`data-explorer-drag-source`）；动作另经隐藏的 `aria-live` 区域播报。指针停在收起的目录行中段 600ms 发出 `drag-expand`；落点换了重新计时。指针在树的横向范围内、离上下边缘不到 24px 时逐帧滚动，越靠边越快，每帧先按滚动后重新渲染的行判一次落点。松手时把那一刻的落点经 `drag-drop` 交出，由宿主决定提交与否。用户自己滚动或行变了而指针没动时撤下落点，原地松手不提交。Escape、指针取消、失去捕获、窗口失焦、页面隐藏发出 `drag-cancel`；`drag` 变为 null（宿主那边取消了）时手势随之收场。拖动结束吞掉末尾的 click。

## 数据

```ts
type Props = {
    rows: ReadonlyArray<Row>;
    /** 选中的行 id。 */
    selected: ReadonlyArray<string>;
    /** 键盘焦点所在的行 id。 */
    focus: string | null;
    locale: DisplayLocale;
    /** 树的可访问名称。 */
    label: string;
    /** 树内按键：没处理、处理了，或要在某一行开右键菜单。`page` 是视口能放下的行数。 */
    handleKey: (key: TreeKey, page: number) => "none" | "handled" | {menu: string};
    /** 项目根的标题（作品的显示名）；不给时显示“项目”。 */
    projectTitle?: string | null;
    /** 正在内联输入的行（新建的输入行或改名的资源行）与它的名字、错误文字、是否在提交；默认 null。 */
    editing?: {id: string; name: string; error: string | null; busy: boolean} | null;
    /** 拖动过了门槛：返回 false 时不起拖；默认不能拖。 */
    startDrag?: (id: string) => boolean;
    /** 拖动中最后显示的落点动作（`web/actions/drop.ts` 的 `DropAction`）；不在拖动为 null。 */
    drag?: {sources: ReadonlyArray<string>; action: DropAction} | null;
    /** 缩进参考线的档位（设置 `nbook.explorer/indentGuides`）；默认 `hover`。 */
    indentGuides?: "none" | "hover" | "always";
    /** 设置“隐藏 Markdown 扩展名”，交给每一行，落点标签里的名字同样处理；默认 false。 */
    hideMarkdownExtension?: boolean;
};

type Emits = {
    (event: "row-press", id: string, modifiers: Modifiers, part: "twisty" | "row"): void;
    (event: "row-activate", id: string): void;
    (event: "row-context", id: string, x: number, y: number): void;
    /** 读取失败的目录行点了行尾的错误按钮。 */
    (event: "retry", address: string): void;
    (event: "focus-change", focused: boolean): void;
    (event: "edit-input", name: string): void;
    (event: "edit-commit"): void;
    (event: "edit-cancel"): void;
    /** 拖动中指针下的行与位置；null 是不在行上或撤下落点。 */
    /** 落点（`web/actions/drop.ts` 的 `DropOver`）：一行与位置、空白或编辑组；null 是哪儿都不是或撤下落点。 */
    (event: "drag-hover", over: DropOver | null): void;
    (event: "drag-drop", over: DropOver | null): void;
    (event: "drag-cancel"): void;
    /** 拖动中停在收起的目录行中段 600ms：展开它。 */
    (event: "drag-expand", id: string): void;
};
```

- 根元素 `role="tree"`、`aria-multiselectable="true"`、`tabindex="0"`；行的角色与属性见 `ExplorerRow`。
- 没有 slots；expose `focus()`（把焦点放回树，不滚动）。attrs 落在根元素上。

## 隐藏通道理由

- `env:portal`：拖动的落点反馈（nb-ui `DropFeedbackOverlay`）、拖影与播报区渲染到 `body`，坐标是视口坐标，要脱离侧栏的裁剪与层叠上下文。
- `env:timer`：触摸按住 200ms 才起拖、停留 600ms 展开，各用一个计时器；抬起、移动、落点换了、取消或卸载时清掉。
- `env:global`：拖动期间在窗口上监听指针移动、松手、Escape、失焦与页面隐藏，并用 `document.elementFromPoint` 找指针下的行或编辑组：指针捕获在树上，移出树与窗口后的移动与松手只有窗口收得到；编辑组是别的插件的元素，只认它的公开标记 `data-editor-group`。拖动结束或组件卸载即拆掉。

## 不支持

不支持变高行；不支持键盘拖动（键盘用剪切粘贴与上移下移达成同样的结果）；不接收从系统文件管理器拖进来的文件（另有 Task）。
