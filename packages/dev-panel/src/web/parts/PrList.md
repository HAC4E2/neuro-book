---
标签: []
---

# PrList

GitHub 页的 PR 列表（t14，只读）：编号（链到 GitHub）、标题、草稿与评审结论、分支、能从分支名认出的 Task（链到面板的 Task 页）、更新时刻、检查汇总（通过、失败、进行中的个数），失败的检查逐个列出并链到详情。

标题、分支名是外部的不可信内容，一律按纯文本插值渲染，不走 Markdown 或 `v-html`；链接只用服务端过滤过的 `https:` 地址（`url` 为 null 时不给链接）。没有任何写按钮。

## 数据

```ts
interface PrListProps {
    /** `/api/github` 的 `prs`；必填 */
    prs: PrView[];
}
interface PrListEmits {
    /** 普通左键点了 Task 链接：页面 `router.push`；带修饰键的点击交给浏览器 */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose。空数组时写“没有开着的 PR”。
