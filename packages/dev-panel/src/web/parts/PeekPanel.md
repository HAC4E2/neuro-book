---
标签: []
---

# PeekPanel

速览面板（t15 阶段 4 第 2 批；D1、决定点 10、17；开发者 10-13：在 Task 页点产物、证据会整页跳走）：在 Task 页旁边看产物页面、文档、证据，不离开这一页。零件只管外框：标题、操作、状态行、关闭、焦点与三种摆法；开着什么（`?peek=`）、取数与内容都在宿主（Task 页）。

## 布局

三种摆法由宿主按内容区宽度定（`mode`）：

- `side` 并排：固定在内容区（外壳的 `main`，不含左栏与它的滚动条）的右边，高度与内容区相同；宿主给正文让出同样的宽度（推开正文）；
- `overlay` 浮层：同样固定在内容区右边，下面一层半透明遮罩盖住内容区，点遮罩关闭；
- `full` 整屏：手机上铺满视口，盖住顶栏。

面板是 `position: fixed`，正文照常由 `main` 滚；位置与大小随测量算（`box`、`width`），写成绑定的 style。自上而下：标题行（标题单行截断，`actions` 插槽，“关闭”按钮）、可选的状态行（`status` 插槽）、正文（`default` 插槽，自己竖向滚动、带 `relative`；父级是 flex 列，iframe 类的内容能占满这一块）。

## 交互与焦点

- 打开时焦点放在标题上（标题 `tabindex="-1"`）；`focusKey` 变了（换了一个东西看）再放一次。
- 焦点在面板里（iframe 之外）时按 Esc 关闭。iframe 里按的键不会冒泡出来，所以总有可见的“关闭”按钮，不只靠 Esc。
- 关闭只发 `close`；关闭后焦点回到哪里、网址怎么改由宿主决定（Task 页：后退或替换掉 `?peek=`，焦点回到打开它的链接）。

## 数据

```ts
interface PeekPanelProps {
    /** 标题（产物标题、文档标题或文件名）；必填 */
    title: string;
    /** 摆法；必填 */
    mode: "side" | "overlay" | "full";
    /** 内容区在视口里的位置与大小（px）；必填，整屏时不用 */
    box: {top: number; left: number; width: number; height: number};
    /** 并排与浮层时面板的宽度（px）；必填 */
    width: number;
    /** 开着的东西的标识（`?peek=` 的值）；变了就把焦点再放到标题上；必填 */
    focusKey: string;
}
interface PeekPanelEmits {
    /** 点了“关闭”、遮罩，或按了 Esc */
    (event: "close"): void;
}
interface PeekPanelSlots {
    /** 正文；必填 */
    default: () => unknown;
    /** 标题行里的操作（“去答复”“打开完整页”）；可选 */
    actions?: () => unknown;
    /** 标题下面的一行状态（产物的状态、必答数、版本）；可选 */
    status?: () => unknown;
}
```

没有 expose。读屏器按 `role="dialog"` 读，名字是标题；浮层与整屏是模态（`aria-modal`），并排不是（正文照常能操作）。
