---
标签: []
---

# NotifyStatus

答复之后的通知状态（t11）：每条待发的通知一行（谁问的、在等什么、能做什么），每次尝试一行（发出去了没有、要不要马上看终端）。产物页在答复成功后用它显示这次答复的通知，会话页用它列出全部。它只显示与发出意图，发送、“不通知”与“会话已更换”的小窗都由页面处理；投递时弹出确认界面、面板在投递途中退出这类要马上看终端的结果用醒目的色调，可以逐条“知道了”（判据是 `host/format.ts` 的 `attemptNeedsAttention`，与左栏的计数同一份）。投递了但没核对确认界面（`delivered` 加 `unwatched`）用 warning、不算要处理的一条；旧记录里的 `state_jumped`（按状态序号的差值判的，会误报）用普通色调，写“旧判据，可能误报，看一眼终端”。

## 布局

一列行，每行左边是图标与一句话（会话写短名与 pane），右边是这一行的按钮；窄屏时按钮换到文字下面。等输入框清空的行在文字下面给出屏幕末尾（等宽、最多 12 行，超出滚动）。没有任务也没有尝试时显示 `emptyText`（为 null 时什么都不渲染）。

## 数据

```ts
interface NotifyStatusProps {
    /** 通知任务（`/api/notify` 的 `jobs`，已按范围筛过）；必填 */
    jobs: NotifyJob[];
    /** 尝试（`/api/notify` 的 `recent`，已按范围筛过，新的在前）；必填 */
    attempts: NotifyAttempt[];
    /** 每行前面写 `w00022/t11`（会话页的总列表用）；可选，默认 false */
    showTask?: boolean;
    /** 有发送请求在途：按钮禁用；可选，默认 false */
    pending?: boolean;
    /** 已经“知道了”的尝试（attemptId）：醒目的那几种不再带“知道了”按钮、改用普通色调；可选，默认 [] */
    dismissed?: string[];
    /** 没有任务与尝试时的说明；可选，默认 null（不渲染） */
    emptyText?: string | null;
}
interface NotifyStatusEmits {
    /** 点了某个会话的“通知它”（提问者本人、会话已更换后的新会话或持有租约的会话） */
    (event: "send", job: NotifyJob, target: {paneId: string; sessionKey: string}): void;
    /** 点了“不通知” */
    (event: "skip", job: NotifyJob): void;
    /** 会话已更换的那一行点了“处理”：页面打开小窗 */
    (event: "replaced", job: NotifyJob): void;
    /** 醒目的尝试点了“知道了” */
    (event: "dismiss", attemptId: string): void;
}
```

没有插槽与 expose，不透传 attrs 之外的东西。

## 不支持

- 不自己发请求、不记“知道了”（由页面经 `host/prefs.ts` 记在本浏览器）。
- 不显示答复正文：只说多少题、哪个产物，正文在产物页。
