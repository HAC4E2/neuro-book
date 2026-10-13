---
标签: []
---

# StatusChip

Work 或 Task 的状态徽章。只显示记录里写了的状态：没有 `status` 字段的显示“未标”（描边、中性色），取值不合规的显示“不合规”；面板不推断状态（与 t03 第三轮稿子的“推断”画法不同，见 t09 计划的“与 Proposal、实施计划的不一致”）。

## 数据

```ts
type RecordedValue = {value: string | null; origin: "recorded" | "inferred" | "commit" | "unset" | "invalid"; raw?: unknown};
interface StatusChipProps {
    /** 记录里读到的状态；必填 */
    status: RecordedValue;
    /** 尺寸；可选，默认 "sm" */
    size?: "sm" | "md";
}
```

没有事件、插槽与 expose；attrs 落到徽章根节点。
