---
标签: []
别名: ["书卡"]
---

# BookCard

书架卡片视图里的一部作品（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 5）：左边封面（84px 宽，`BookCover`），右边书名（宋体）、两行简介（没有写“还没有简介”）、底部字数与篇数、最近编辑时间与新鲜度说明（`stale` 写“统计于某时”，`counting` 写“正在统计”，`none` 写“尚未统计”）；正在打开的作品底部是一个绿点加“已打开”。右上角“更多”（在新窗口打开、编辑信息、从书架移除）悬停或选中时才出现。

颜色只落在封面上：卡片是纸面、没有色条或色带（设计语言“归属不靠贴色”）。

## 交互

- 点卡片发 `pick` 再发 `open`（打开作品）；点“更多”不打开。
- 根节点是 `role="option"`，选中与否由 `active` 给，选中态复用主题的焦点环；键盘与选中归 [`ShelfCards`](ShelfCards.md)。
- 悬停微抬；系统设了减少动画时不动。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    item: ShelfItem;
    /** 相对时间按它算（ISO）。 */
    now: string;
    /** 封面图地址；null 用排版封面。 */
    coverSrc: string | null;
    active: boolean;
    /** 列表框里的选项 id。 */
    optionId?: string;
};
type Emits = {
    pick: [id: string];
    open: [id: string];
    "open-new-window": [id: string];
    edit: [id: string];
    remove: [id: string];
};
```

没有插槽与 expose；attrs 落在根 `article` 上（带 `data-book-card="<id>"`）。
