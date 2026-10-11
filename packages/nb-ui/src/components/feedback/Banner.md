---
标签: []
---

# Banner

`Banner` 是区域或页面顶部的一条常驻横幅：满宽、平铺、无投影，用 `info`、`success`、`warning` 或 `error` 色调呈现一件持续存在的事（已断开正在重连、有新版本要刷新、正在用默认布局）。它与 `Notification` 的区别是不进队列、不自动消失，什么时候出现与收起由宿主决定。

## 布局与状态

从左到右是色调图标、标题与正文（同一行，窄时正文换到下一行）、可选动作按钮、可选关闭按钮。只有一层底边线，没有圆角与投影：它是容器顶部的一节，不是浮在上面的卡片。

`error` 色调的根节点是 `role="alert"`（出现时读屏立刻播报），其余是 `role="status"`。组件没有禁用、加载或错误覆盖态。

## 数据

```ts
type BannerTone = "info" | "success" | "warning" | "error";

interface BannerProps {
    /** 色调；默认 "info" */
    tone?: BannerTone;
    /** 标题；默认空字符串 */
    title?: string;
    /** 正文；默认空字符串 */
    message?: string;
    /** 动作按钮文字；默认空字符串，空则不显示按钮 */
    actionLabel?: string;
    /** 是否显示关闭按钮；默认 false */
    dismissible?: boolean;
    /** 关闭按钮的可访问名称；默认 "关闭" */
    closeLabel?: string;
}

interface BannerEmits {
    /** 点击动作按钮；不会自动执行动作 */
    (event: "action"): void;
    /** 点击关闭按钮；不会自行隐藏 */
    (event: "dismiss"): void;
}

interface BannerSlots {
    title?: () => any;
    default?: () => any;
    action?: () => any;
}
```

插槽优先于对应文字。`dismiss` 与 `action` 只发事件，宿主负责收起横幅或执行动作。没有 `expose` API；未声明的 attrs 落到根 `div`。
