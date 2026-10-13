---
标签: []
---

# DiffView

显示一段统一差异：`git diff` 的输出，或编辑页按行算出的“别人改了什么”（`host/line-diff.ts` 的 `diffText`）。新增与删除的行着色，`@@` 与文件头变灰，等宽字体，过高时在框内滚动。

## 数据

```ts
interface DiffViewProps {
    /** 统一差异的文本；必填 */
    text: string;
}
```

没有事件、插槽与 expose。
