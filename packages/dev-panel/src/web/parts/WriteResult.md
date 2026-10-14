---
标签: ["state:local"]
---

# WriteResult

一次写入（以及会话页的按键、文字、接管）的结果（t15 阶段 3c，替换 t10 的 `WriteNotice`）。结果与附注分两层：结果的颜色与图标只由结果决定（成功绿、失败红、冲突与结果未知黄、提示用强调色：映射到 nb-ui `Notification` 的 `success`、`error`、`warning`、`info` 色调，`info` 取 `--accent-main`），成功带警告仍是绿色；服务端的警告作为附注缩进放在下面、默认折叠。字段错误只报一次：能锚到表单字段或题号的由表单显示，这里只写“表单里标出了 N 处”。底层是 nb-ui 的 `Notification`。

## 布局

一张通知卡：结果图标与标题，下一行是原因或下一步（`message`），再下面是结果的明细列表（`items`：没锚到字段的问题、写入了没提交的路径）。有附注时最后一行是“附注 N 条”的开关，展开后缩进列出。右上角关闭；只有确定什么都没写的失败给“重试”。宽度跟父级走。

位置由宿主放，零件不定位、不计时、不自己消失：有操作栏的页面（编辑页、新建页）放在操作栏里，出现时不推动编辑器与表单；其余页面放在 `PageShell` 的 `feedback` 插槽。

## 数据

```ts
type NoticeOutcome = "success" | "failure" | "conflict" | "unknown" | "info";
type Notice = {
    /** 结果：决定颜色与图标 */
    outcome: NoticeOutcome;
    /** 一句话的结果，例如“已保存”“没有保存” */
    title: string;
    /** 原因或下一步；可为空串 */
    message: string;
    /** 结果的明细，已与 message 去重 */
    items: string[];
    /** 附注（服务端的警告），默认折叠 */
    notes: string[];
    /** 是否给“重试” */
    retry: boolean;
};
interface WriteResultProps {
    /** 要显示的结果（host/writes.ts 的 successNotice、failureNotice、plainNotice 生成）；必填 */
    notice: Notice;
}
interface WriteResultEmits {
    /** 点了关闭 */
    (event: "dismiss"): void;
    /** 点了“重试”（只在 notice.retry 为真时出现） */
    (event: "retry"): void;
}
```

没有插槽与 expose；attrs 落到根节点（`Notification` 的根）。

## 状态

`state:local`：附注是否展开；换了一条结果（`notice` 换了对象）时收起。

## 不支持

- 不排队、不叠多条：宿主同一时间只给一条。
- 不自己消失、不计时。
- 不显示字段级的错误：交给表单。
