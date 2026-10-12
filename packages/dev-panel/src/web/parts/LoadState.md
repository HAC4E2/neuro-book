---
标签: []
---

# LoadState

面板里加载与失败的唯一形态：占满它要交代的那块区域并居中，加载是一枚转动的指示加一句说明，失败是状态图标、原因与重试。它本身不计时，延时出现（约 200 毫秒，快的请求不闪）由数据宿主给的 `loading` 负责（nb-ui 规范第 4.3 节）。

## 数据

```ts
interface LoadStateProps {
    /** 正在加载（宿主已经延时过的信号）；必填 */
    loading: boolean;
    /** 失败的原因；有它时显示失败，优先于加载；可选，默认 null */
    error?: {message: string} | null;
    /** 加载时的说明；可选，默认 "正在读取" */
    label?: string;
    /** 失败时是否给“重试”；可选，默认 true */
    retryable?: boolean;
}
interface LoadStateEmits {
    /** 点“重试” */
    (event: "retry"): void;
}
```

没有插槽、没有 expose；attrs 落到根节点。两者都不在时什么都不渲染（不占位）。

## 无障碍

加载容器带 `role="status"`、`aria-busy="true"`、`aria-live="polite"`，说明文字独立成立；失败带 `role="alert"`，重试按钮有可访问名称。
