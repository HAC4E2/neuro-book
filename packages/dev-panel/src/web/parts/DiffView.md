---
标签: []
---

# DiffView

显示一段统一差异：`git diff` 的输出，或编辑页按行算出的“别人改了什么”（`host/line-diff.ts` 的 `diffText`）。新增与删除的行着色，`@@` 与文件头变灰，等宽字体，过高时在框内滚动；`fill` 时（差异就是页面正文）不限高、长行折行，由页面滚。

## 数据

```ts
interface DiffViewProps {
    /** 统一差异的文本；必填 */
    text: string;
    /**
     * 差异就是页面正文时（文档页的“与 master 的差异”，t15 阶段 4 第 4 批审查第 6 条）：不限高、长行按行折行，由页面的滚动者滚；
     * 缺省 false 时是预览块：最高 20rem、在框内滚，长行不折、横向滚
     */
    fill?: boolean;
}
```

没有事件、插槽与 expose。
