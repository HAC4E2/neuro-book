---
标签: []
---

# StaleNotice

页面已经显示着数据、这次重取却失败时的一行提示（t15）：写明显示的是什么时候读到的内容、这次为什么没取到，给“重试”。数据宿主在这种情况下保留旧数据（`useResource` 的 `stale`），没有这行提示，开发者会把旧数据当成最新的。首次加载与首次失败仍由 `LoadState` 管。

## 布局

一行紧凑的提示条（浅底、小字、可换行）：前面一个“旧数据”图标，中间是说明，后面是“重试”。找不到（404）时说明改成“已经找不到了（可能被删或改了名）”，不给“重试”，有上一级的地址时给一个“回到上一级”的链接。

## 数据

```ts
interface StaleNoticeProps {
    /** 这次重取的失败（`useResource` 的 `error`）；必填 */
    error: {message: string; status: number};
    /** 显示的数据是什么时候读到的（`useResource` 的 `receivedAt`，ISO）；必填，可为 null */
    receivedAt: string | null;
    /** 找不到时“回到上一级”去哪里（`host/routes.ts` 拼的地址）；可选，默认 null，不给链接 */
    upHref?: string | null;
    /** 上一级链接的文字；可选，默认 "回到上一级" */
    upLabel?: string;
}
interface StaleNoticeEmits {
    /** 点“重试” */
    (event: "retry"): void;
    /** 普通左键点“回到上一级”：零件已 preventDefault，宿主 router.push；中键与带修饰键的点击交给浏览器 */
    (event: "navigate", href: string): void;
}
```

没有插槽、没有 expose；attrs 落到根节点。

## 无障碍

根是 `role="status"`：出现时读屏器会念出来，不打断当前操作。“重试”是按钮，“回到上一级”是真实链接。
