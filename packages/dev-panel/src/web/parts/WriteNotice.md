---
标签: []
---

# WriteNotice

一次写入的结果（t10）：成功（含“内容没变，没有提交”与警告）、失败的原因与补救（已写入未提交的路径）、结果未知。只有确定什么都没写的失败（等锁超时、面板正在启动）给“重试”。底层是 nb-ui 的 `Notification`。

## 数据

```ts
type Notice = {tone: "success" | "warning" | "error" | "info"; title: string; message: string; items: string[]; retry: boolean};
interface WriteNoticeProps {
    /** 要显示的结果（host/writes.ts 的 successNotice、failureNotice 生成）；必填 */
    notice: Notice;
}
interface WriteNoticeEmits {
    (event: "dismiss"): void;
    /** 点了“重试”（只在 `notice.retry` 为真时出现） */
    (event: "retry"): void;
}
```

没有插槽与 expose。
