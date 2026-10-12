---
标签: []
---

# MarkdownView

渲染一段已经清洗、改写过链接的 Markdown HTML（由页面经 `host/markdown.ts` 生成）。它只负责排版与把站内链接的点击交给宿主：带 `data-internal` 的链接点了不整页跳转，而是发出 `navigate`，由页面用路由跳转；站外链接照常在新窗口打开。

## 数据

```ts
interface MarkdownViewProps {
    /** 清洗过的 HTML；必填。只接受 host/markdown.ts 的输出，不要传未清洗的内容 */
    html: string;
}
interface MarkdownViewEmits {
    /** 点了站内链接（文档页、产物页）；参数是面板内的地址 */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose。正文样式是 app.css 的 `.nbdev-markdown`（阅读刻度、表格横向滚动）。

## 注意事项

清洗在 `renderMarkdown` 里做（去掉 `style`、表单与控件），本组件用 `v-html` 原样渲染，所以只能接 `renderMarkdown` 的结果。
