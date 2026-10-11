---
标签: []
别名: ["空书架", "Empty Shelf"]
---

# ShelfEmptyState

书架上一部作品都没有时的引导卡（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 2）：放在书架页上半、继续写作卡的位置。左边是看板娘（`NeuroBookMood`，认真看书的 `focus` 状态），右边说清楚两件事——作品是一个文件夹、新作品会建在哪——再给两个入口。

## 布局

- 稿面材质（`--page-surface`）与继续写作卡相同，圆角 `--radius-panel`。
- 看板娘 112px 正方；右侧：标题（宋体 `--text-xl`）、两段说明（第一段宋体 16px，第二段界面字小字），按钮行：主按钮“新建作品”、次按钮“加入已有目录”。
- 容器不足 480px 时上下排、居中。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    /** 作品目录；null 表示还没设，说明改成“第一次新建时会问”。 */
    library: string | null;
};
type Emits = {
    create: [];
    "add-existing": [];
};
```

## 不支持

不自己取作品目录，也不打开对话框：都由书架页宿主做。
