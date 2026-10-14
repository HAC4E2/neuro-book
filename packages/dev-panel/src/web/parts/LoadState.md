---
标签: []
---

# LoadState

一份资源的状态（t15 阶段 3d 收进了阶段 1 的 `StaleNotice`）：还没有数据时，加载、找不到、失败各占一块区域并居中；已经有数据、这次重取失败时只画一行“旧数据”提示，页面照常显示上次读到的内容。它本身不计时，延时出现（约 200 毫秒，快的请求不闪）由数据宿主给的 `loading` 负责（nb-ui 规范第 4.3 节）。宿主一般用 `host/panel-data.ts` 的 `loadStateOf(resource)` 给前四个属性。

不做骨架屏：nb-ui 界面开发规范第 4.3 节第 8 条“不做骨架”（占位形状会暗示一个还不知道的结构）。加载时不跳靠两件事：页面的页头（`PageShell`）在数据到之前就渲染；这里在还没有数据时总占住一块最小高度。

## 布局

- 加载：转动的指示加一句说明。
- 找不到（`error.status` 为 404）：图标、“找不到”接上 `subject`（没给时写“找不到了”）、“可能被删或改了名”，给“回到上一级”（宿主给了 `upHref` 时，`ActionLink` 的样子），不给重试。服务端的 404 原因只有“找不到”，不再显示。
- 失败：图标、原因、“重试”。
- 旧数据（`hasData` 为真且有 `error`）：一行浅底提示，“显示的是 N 前读到的内容；这次重取失败：原因”加“重试”；404 时写“已经找不到”接上 `subject` 与“了（可能被删或改了名）”，给上一级的链接，不给重试。
- 还没有数据、也还没到显示加载的时候：一块同样最小高度（10rem）的空白，不画任何东西。
- 前三种占满它要交代的那块区域、最小高度 10rem；宽度跟父级走。

## 数据

```ts
interface LoadStateProps {
    /** 正在加载（宿主已经延时过的信号）；必填 */
    loading: boolean;
    /** 失败；status 为 404 时按“找不到”画；可选，默认 null */
    error?: {message: string; status?: number} | null;
    /** 已经有数据：有 error 时只画一行旧数据提示；可选，默认 false */
    hasData?: boolean;
    /** 显示着的数据是什么时候读到的（ISO）；可选，默认 null（写“之前”） */
    receivedAt?: string | null;
    /** 加载时的说明；可选，默认 "正在读取" */
    label?: string;
    /** 失败时是否给“重试”；可选，默认 true */
    retryable?: boolean;
    /** 找不到时“回到上一级”去哪里（host/routes.ts 拼的地址）；可选，默认 null，不给链接 */
    upHref?: string | null;
    /** 上一级链接的文字；可选，默认 "回到上一级" */
    upLabel?: string;
    /** 找不到的是什么，接在“找不到”后面，例如 "w00022-dev-panel 这个 Work"；可选，默认 null */
    subject?: string | null;
}
interface LoadStateEmits {
    /** 点“重试” */
    (event: "retry"): void;
    /** 普通左键点“回到上一级”：零件已 preventDefault，宿主 router.push；中键与带修饰键的点击交给浏览器 */
    (event: "navigate", href: string): void;
}
```

没有插槽、没有 expose；attrs 落到根节点（几种形态各自的根）。有数据且没有错误时什么都不渲染。

## 无障碍

加载容器带 `role="status"`、`aria-busy="true"`、`aria-live="polite"`，说明文字独立成立；失败与找不到带 `role="alert"`；旧数据的提示是 `role="status"`，出现时读屏器会念出来，不打断当前操作。“重试”是按钮，“回到上一级”是真实链接（`ActionLink`）。

## 不支持

- 不做骨架屏（见上）。
- 不取数、不读路由：状态、上一级的地址与找不到的是什么都由宿主给。上一级要是真能到的地方：不要指回同一个找不到的地址。
