---
标签: []
---

# PageShell

面板每一页的骨架（t15 阶段 3b）：页头（面包屑、状态与标题、右侧操作、说明行、写入结果）加正文，内容宽度分阅读、列表、满铺三档。各页的内边距、标题字号与标题的顶边都由它给，所以换页时标题停在同一个位置；阅读档按正文的阅读宽度收，Task 页、文档页的正文卡片右边不再空一片。它只管页头与宽度，不取数、不读路由、不管加载与失败。

## 布局

- 页头自上而下：面包屑（有才显示）；标题行（左边状态插槽与 `h1`，右边操作插槽，窄时操作折到下一行；至少 2rem 高，有没有状态徽章、操作按钮，标题都停在同一处）；说明行（编号、更新时间、来源，`nbdev-note` 的字号与颜色，可换行）；写入结果插槽。页头之后是正文。页头在数据到之前就渲染（标题先给编号或页面名），数据到了只换文字，高度不跳。
- 宽度：
  - `list`（缺省）：最宽 90rem，居中；
  - `reading`：容器按内容收窄（`fit-content`，最多 100%）并居中，页头不撑宽容器（`contain: inline-size`）。正文卡片用 `nbdev-reading-card`（字号取 `--reading-size`，宽度是 `--reading-measure` 加卡片内边距），所以容器宽度就是“阅读宽度的卡片”加上页面自己放在旁边的侧栏；
  - `full`：铺满可用宽度（产物页的 iframe）。
- 内边距 1rem，768px 以上 1.5rem；页头与正文、正文各区之间的间距 1.25rem（`nbdev-stack-page`）。390 宽时结构不变，标题与操作各占一行。

## 交互

面包屑是真实链接：普通左键点击时零件 `preventDefault` 并发 `navigate`，由页面 `router.push`；中键与带修饰键的点击交给浏览器。最后一项是当前页，不可点。标题是页面唯一的 `h1`，外壳换页时把焦点放到它上面、“跳到主内容”也落在它上面（见 docs/panel.md 的“可访问性”）。

## 数据

```ts
interface PageShellProps {
    /** 面包屑，从外到内；最后一项是当前页，不必给 href；可选，默认 []（不显示）。首页也给一项“首页”，各页标题的顶边才一致 */
    crumbs?: Array<{label: string; href?: string}>;
    /** 页标题（h1 的文字）；必填。插槽 title 只换显示 */
    title: string;
    /** 内容宽度；可选，默认 "list" */
    width?: "reading" | "list" | "full";
}
interface PageShellEmits {
    /** 面包屑的普通左键点击；参数是面板内的地址 */
    (event: "navigate", href: string): void;
}
interface PageShellSlots {
    /** 替换标题的显示（例如编辑页的等宽路径）；仍在 h1 里 */
    title?: () => unknown;
    /** 标题前：状态徽章 */
    status?: () => unknown;
    /** 标题行右侧：这一页的操作（写入用 nb-ui Button，去别的页用 ActionLink） */
    actions?: () => unknown;
    /** 标题下的说明行：编号、更新时间、来源 */
    meta?: () => unknown;
    /** 页头下：这一页的写入结果（WriteResult） */
    feedback?: () => unknown;
    /** 正文 */
    default?: () => unknown;
}
```

没有 expose；attrs 落到根节点。

## 不支持

- 不取数、不读路由、不跳转（面包屑的跳转由页面做）。
- 不管加载、失败与旧数据：页面在正文里放 `LoadState`。
- 不管滚动：流式页面由外壳的 `main` 滚，铺满型页面（文档页）自己分栏。
- 不放侧栏与速览面板：Task 页的侧栏由页面在正文里摆；速览面板在阶段 4。

## 注意事项

- 阅读档的容器按内容收窄：正文里要有一块定宽的东西（`nbdev-reading-card`，或宽度受 `--reading-measure` 限制的 Markdown），否则内容很短时页面会跟着变窄。
