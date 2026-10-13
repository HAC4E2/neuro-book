---
标签: ["env:portal", "env:global"]
---

# ReplacedDialog

提问的会话已经不在了、它原来的 pane 上换成了另一个会话（`/clear` 或重开）时的小窗（t11 场景 3）：写明谁问的、pane 上现在是谁、要发的整行文字，让开发者在“发给现在的会话”与“不通知”之间选一个。新会话没读过这道题，发不发要人定，所以不自动发；小窗没有关闭叉，点遮罩与 Esc 也不关，两个出口必选其一（任务一直留在会话页与顶栏的计数里，开发者可以先不打开它）。

## 布局

`md` 尺寸的模态窗：三行说明（提问者、现在的会话、要发的文字；文字等宽、可换行），页脚右侧是“不通知”与“发给现在的会话”。390 宽时窗口收进视口。

## 数据

```ts
interface ReplacedDialogProps {
    /** 是否打开；必填、受控 */
    open: boolean;
    /** 会话已更换的那条任务（`state` 为 `replaced`）；必填，null 时不渲染正文 */
    job: NotifyJob | null;
    /** 请求进行中：两个按钮禁用；可选，默认 false */
    pending?: boolean;
}
interface ReplacedDialogEmits {
    /** 发给现在的会话（`job.replacedBy`） */
    (event: "send", job: NotifyJob, target: {paneId: string; sessionKey: string}): void;
    (event: "skip", job: NotifyJob): void;
}
```

没有插槽与 expose。内容经 nb-ui 的 `Dialog` 渲染到 `body`（`env:portal`）；`Dialog` 的键盘监听（Tab 在窗内循环）是 `env:global`，Esc 与遮罩的关闭已关掉。
