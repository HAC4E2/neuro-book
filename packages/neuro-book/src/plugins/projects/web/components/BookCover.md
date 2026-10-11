---
标签: []
别名: ["封面"]
---

# BookCover

一部作品的封面（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 5）：有封面图就显示图，没有（或图加载失败）就按书名与作品色排一张：作品色作底，上方一道金色细线，书名居中用宋体，下方一行小字。宽度由使用方给，高按 2:3；右侧两个角比左侧圆，像书口。

作品色：作者指定了主题色就用它，没有按 id 在八档色相里取一档（`bookColorStyle`）；指定的颜色够亮时字用深色。

## 数据

```ts
type Props = {
    id: string;
    title: string;
    color: string | null;
    /** 封面图地址；null 或加载失败时用排版封面。 */
    src?: string | null;
    /** 宽度（px），默认 84。 */
    width?: number;
    /** 排版封面下方的小字，默认空。 */
    caption?: string;
};
```

没有事件、插槽与 expose。根节点是 `role="img"`，可访问名称是书名；排版封面带 `data-book-cover-typo`。

## 不支持

不裁剪、不上传、不缓存：地址变了就重新加载。
