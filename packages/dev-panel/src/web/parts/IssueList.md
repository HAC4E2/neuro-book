---
标签: []
---

# IssueList

GitHub 页的 Issue 列表（t14，只读）：编号（链到 GitHub）、标题、标签、更新时刻。标题与标签是外部的不可信内容，一律按纯文本插值渲染；链接只用服务端过滤过的 `https:` 地址。没有任何写按钮。

## 数据

```ts
interface IssueListProps {
    /** `/api/github` 的 `issues`；必填 */
    issues: IssueView[];
}
```

没有事件、插槽与 expose。空数组时写“没有开着的 Issue”。
