---
标签: []
别名: ["卡片视图"]
---

# ShelfCards

书架的卡片视图（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 5、6）：书卡（[`BookCard`](BookCard.md)）排成网格，列数随宽度（每列至少 300px）。空书架时网格里是两张和书卡同样大小的“待写的书”：“新建作品”（封面位是一个加号，底行写新作品会放在哪个作品目录）与“打开已有作品”（封面位是文件夹），书架从空到有只是网格里多了几张卡。

## 交互

- 网格是 `listbox`（有作品时）：左右方向键移动选中，上下按当前列数跳一行，Home、End 到两端，Enter 打开选中的作品，Delete 请求移出书架；聚焦时没有选中就选第一部。
- 点卡片选中并打开（`BookCard` 的 `pick`、`open`）；卡片上的“更多”另发事件。
- 空书架的两张卡是按钮，发 `create`、`add-existing`。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    items: ReadonlyArray<ShelfItem>;
    activeId: string | null;
    now: string;
    /** 一部作品的封面图地址；没有封面为 null。 */
    coverSrc: (item: ShelfItem) => string | null;
    /** 空书架时写在“新建作品”卡上的作品目录。 */
    library: string;
};
type Emits = {
    "update:activeId": [id: string];
    open: [id: string];
    "open-new-window": [id: string];
    edit: [id: string];
    remove: [id: string];
    create: [];
    "add-existing": [];
};
```

根节点带 `data-shelf-cards`；空书架时另带 `data-shelf-empty`，两张卡带 `data-shelf-create`、`data-shelf-add`。没有插槽与 expose。
