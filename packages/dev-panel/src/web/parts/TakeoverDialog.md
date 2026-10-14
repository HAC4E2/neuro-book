---
标签: ["env:portal", "env:global"]
---

# TakeoverDialog

接管键盘之前的提示与确认（t12）。接管会把真实终端改成网页的尺寸（herdr 那边重排），herdr 那边的键盘与其它程序照样能写进这个终端（herdr 不拦），接管期间面板不自动投递通知，切到别的标签页、关掉页面、断线、15 分钟没有输入都会自动释放。别处已经在控制（本面板的另一个浏览器，或别的程序）时，同一个小窗改成“确认抢过来”。

小窗针对发起接管时的目标：会话页记下当时的 pane、终端与会话，确认时目标变了就不接管、给提示；“抢过来”沿用发起接管时的目标与尺寸（宿主负责，t15）。

## 布局

`md` 尺寸的模态窗：一句说明，几条要点（尺寸从多少改成多少；读不到原尺寸时写“释放时不改回”），页脚“取消”与确认按钮。390 宽时收进视口（手机上不给接管，一般不会出现）。

## 数据

```ts
interface TakeoverDialogProps {
    /** 是否打开；必填、受控 */
    open: boolean;
    /** 现在的尺寸与是否读到了真实尺寸；必填 */
    current: {cols: number; rows: number; known: boolean};
    /** 接管后的尺寸（网页按 13px 字号算出的）；必填 */
    next: {cols: number; rows: number};
    /** 别处已经在控制时的说明；为 null 时是普通的接管提示；必填 */
    conflict: {reason: "controlled_elsewhere" | "other_browser"; text: string | null; since: string | null} | null;
    /** 请求在途；可选，默认 false */
    pending?: boolean;
}
interface TakeoverDialogEmits {
    (event: "confirm"): void;
    /** 取消、点遮罩或按 Escape */
    (event: "cancel"): void;
}
```

没有插槽与 expose。内容经 nb-ui 的 `Dialog` 渲染到 `body`（`env:portal`），Esc 与点遮罩关闭（`env:global`）。
