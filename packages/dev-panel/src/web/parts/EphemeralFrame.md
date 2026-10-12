---
标签: []
---

# EphemeralFrame

装临时数据（会话、租约、谁在动、运行）的虚线框，角上一个“临时”小标。持久的数据画实线的面，临时的一律用它，开发者一眼分得清哪些会随会话结束而消失（t03 第三轮已定的画法）。

## 数据

```ts
interface EphemeralFrameProps {
    /** 框的标题（例如“谁在动”）；必填 */
    title: string;
}
interface EphemeralFrameSlots {
    /** 框里的内容；必填 */
    default: () => any;
}
```

没有事件与 expose；attrs 落到根节点。框不给面色（不叠层级），只有信息色的虚线边。
