---
标签: ["env:portal", "env:global"]
---

# ScreenConfirmDialog

替开发者往会话里打字或按键之前的第二步（t11）：先给出会话屏幕末尾的样子与将要做的事（“将按下 Enter”、“输入框里有字，仍然发送这一行”），开发者看过再点确认。用在三处：会话页的 Enter、y、n、Esc、Ctrl+C、Shift+Tab，输入框里的文字判定不可投时，手动通知判定不可投时。屏幕是打开时读的那一份，不实时刷新（实时终端在 t12）。

确认针对打开时的目标：会话页记下打开时的 pane、终端与会话，确认那一刻选中的目标变了就关掉本窗、不发送，并提示目标变了（宿主负责，t15）。

## 布局

`md` 尺寸的模态窗：一句说明，下面是屏幕末尾（等宽、保留空白、最多约 20 行高，超出滚动），页脚右侧是“取消”与确认按钮。390 宽时窗口收进视口（`md` 的宽度是 `100vw - 32px`）。

## 数据

```ts
interface ScreenConfirmDialogProps {
    /** 是否打开；必填、受控 */
    open: boolean;
    /** 标题；必填 */
    title: string;
    /** 将要做的事与原因；必填 */
    message: string;
    /** 屏幕末尾；必填，null 时写“读不到屏幕” */
    screen: string | null;
    /** 确认按钮的文字；必填 */
    confirmLabel: string;
    /** 确认按钮的色调；可选，默认 "danger" */
    tone?: "danger" | "primary";
    /** 确认的请求进行中；可选，默认 false */
    pending?: boolean;
}
interface ScreenConfirmDialogEmits {
    (event: "confirm"): void;
    /** 取消、点遮罩或按 Escape */
    (event: "cancel"): void;
}
```

没有插槽与 expose。内容经 nb-ui 的 `Dialog` 渲染到 `body`（`env:portal`），Esc 与点遮罩关闭（`env:global`，都发 `cancel`）。
