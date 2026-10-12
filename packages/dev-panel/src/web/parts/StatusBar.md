---
标签: []
---

# StatusBar

一个 Work 里各状态 Task 的计数条与图例：一条按比例分段的细条（计划中、进行中、完成、搁置、未标、不合规），下面一行图例只列计数不为零的状态。计数来自记录，不推断：多数 Task 没有 `status` 时整条是“未标”的灰色，这是如实的显示。

## 数据

```ts
type TaskCounts = Record<"planned" | "active" | "done" | "shelved" | "unset" | "invalid", number>;
interface StatusBarProps {
    /** 各状态的 Task 数；必填 */
    counts: TaskCounts;
}
```

没有事件、插槽与 expose。全部为零时细条显示为空的轨道，图例写“还没有 Task”。细条带 `role="img"` 与概括全部计数的 `aria-label`。
