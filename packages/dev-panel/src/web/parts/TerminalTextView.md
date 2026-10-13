---
标签: ["state:local"]
---

# TerminalTextView

手机上的会话文字视图（t12）：把终端流的当前屏幕转成可换行的纯文字，窄屏上比缩小的终端画面好读。文字来自同一条 observe 流（零件里一个不挂到页面上的 xterm 实例解析帧，读它缓冲区里的行），实时（文字最多每 200 毫秒更新一次），不调 `agent.read`，不会滚动 Claude 的界面。只有当前这一屏；omp 的更早输出由页面另读（`/api/sessions/:pane/history`），不在这个零件里。

## 布局

一个等宽、可换行的文字块（`pre-wrap`，长行折行），最多约 60% 视口高，超出在块里滚动；文字为空时写“还没有画面”。

## 数据

```ts
interface TerminalTextViewProps {
    /** 帧的来源（页面的终端连接）；必填 */
    source: TerminalSource;
}
```

没有事件、插槽与 expose。解析用的 xterm 实例是零件自己的（`state:local`），卸载时销毁。
