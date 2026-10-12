---
标签: []
---

# WorkCard

首页的一张 Work 卡片（t03 第三轮首页 A）：状态与标题、目标、各状态 Task 的计数条、待答提问数、最近更新；来自分支的 Work 带警示条；“谁在动”放在虚线框里（临时数据）。卡片只回答“这个 Work 在等我吗、在动吗”，Task 的明细在 Work 页。

## 数据

```ts
interface WorkCardProps {
    /** `/api/overview` 里的一个 Work；必填 */
    work: OverviewWork;
}
interface WorkCardEmits {
    /** 点标题打开 Work 页 */
    (event: "open", workId: string): void;
}
```

没有插槽与 expose；attrs 落到卡片根节点。

## 布局

自上而下：标题行（状态徽章、编号、标题按钮）、目标（最多三行）、计数条、一行元信息（待答数、最近更新）、来自分支的警示、谁在动。卡片宽度由父网格决定，内容变多时目标先截断。390 宽时卡片占满一列。
