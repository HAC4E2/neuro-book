---
标签: ["state:local", "env:portal", "env:global"]
---

# DeveloperMessageDialog

把答复的事告诉一个**不是提问者**的会话之前，让开发者看过、改过要发的话（t11，实现审查第 2 条）。两种情形：提问的会话已经换了、它原来的 pane 上是另一个会话（“会话已更换”，场景 3）；提问者不在 herdr 里，开发者选一个持有这个 Task 租约的会话（“没有可通知的会话”，场景 4）。根 `AGENTS.md` 的 `[nbdev]` 规则只让提问者照做，所以这里发的不是 `[nbdev]` 通知，而是以开发者名义的一段普通消息：预填“开发者在面板上答复了 <W>/<T> 的提问……”，开发者可以先改；发之前服务端同样核对会话是否空闲、输入框是否为空。

## 布局

`md` 尺寸的模态窗：一句说明，下面是几行事实（谁问的、要发给谁、它现在的状态），再下面是消息的编辑框（6 行，最多 4000 字），页脚右侧两个按钮。390 宽时窗口收进视口。

## 交互

- 会话已更换（`kind: "replaced"`）：两个出口“不通知”与“发给现在的会话”，没有关闭叉，点遮罩与 Esc 不关（任务一直留在会话页与顶栏的计数里，开发者可以先不打开它）。
- 选了持有租约的会话（`kind: "alternative"`）：“取消”与“发送”，Esc 与点遮罩等于取消。
- 编辑框是空的、或者以 `[nbdev]` 开头时，发送按钮禁用并写明原因（服务端也拒绝）。

## 数据

```ts
interface DeveloperMessageDialogProps {
    /** 是否打开；必填、受控 */
    open: boolean;
    /** 要发的任务与目标会话；必填，null 时不渲染正文 */
    compose: {job: NotifyJob; target: NotifyCandidate; kind: "replaced" | "alternative"} | null;
    /** 请求进行中：按钮禁用；可选，默认 false */
    pending?: boolean;
}
interface DeveloperMessageDialogEmits {
    /** 发送开发者确认过的消息 */
    (event: "send", job: NotifyJob, target: {paneId: string; sessionKey: string}, text: string): void;
    /** 会话已更换时选“不通知” */
    (event: "skip", job: NotifyJob): void;
    /** 选了持有租约的会话、又取消 */
    (event: "cancel"): void;
}
```

编辑框的内容是零件自己的（`state:local`），`compose` 换了就重置为 `job.developerMessage`。没有插槽与 expose。内容经 nb-ui 的 `Dialog` 渲染到 `body`（`env:portal`）；`Dialog` 的键盘监听是 `env:global`。

## 不支持

- 不发给提问者本人：提问者收到的是固定的 `[nbdev]` 指针消息，不经这个小窗。
