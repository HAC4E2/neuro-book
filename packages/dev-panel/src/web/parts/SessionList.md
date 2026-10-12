---
标签: []
---

# SessionList

会话页的会话列表（t03 第三轮会话页的左半边）：以会话 id 加 Agent 名称认会话，herdr 里的状态（空闲、工作中、受阻、完成一轮）与它派出的运行分开列——会话 idle 而它派出的审查还在跑时，状态写 idle、运行另列在下面。会话持有的租约是虚线胶囊。会话、租约与运行都是临时数据，整块放在虚线框里由页面负责。

## 数据

```ts
interface SessionListProps {
    /** 会话（`/api/sessions` 的 `sessions`）；必填 */
    sessions: SessionView[];
}
```

没有事件、插槽与 expose。空数组时显示“没有会话持有租约或运行”。
