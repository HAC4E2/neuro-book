---
标签: []
---

# LeaseChip

一份租约（某个会话在动某个 Task）的虚线胶囊。租约是临时数据，所以按 t03 第三轮的画法用信息色虚线：超过 2 小时没有 Task 相关操作的淡化，已失效的划掉。

## 数据

```ts
interface LeaseChipProps {
    /** 会话的短名（标签或 Agent 加会话 id 的前几位）；必填 */
    session: string;
    /** 在动的 Task（编号）；可选，不给时只显示会话 */
    task?: string | null;
    /** 超过 2 小时没有 Task 相关操作；可选，默认 false */
    stale?: boolean;
    /** 已失效（会话已退出、提问者已不在）；可选，默认 false */
    ended?: boolean;
    /** 悬停说明（例如最近一次操作的时刻）；可选 */
    hint?: string;
}
```

没有事件、插槽与 expose。
