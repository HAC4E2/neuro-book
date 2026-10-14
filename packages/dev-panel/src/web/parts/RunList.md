---
标签: []
---

# RunList

一组运行（会话派出的、或无主的长期进程）：命令行、在哪个 checkout、跑了多久、子进程数；systemd 单元与所在 pane 写在后面。无主的运行若带着已经不在的会话的标记，标出“会话已不在”。

## 数据

```ts
interface RunListProps {
    /** 运行；必填 */
    runs: RunView[];
    /** 是否写出所在 pane（“在跑”页用，pane 号链到会话页）；可选，默认 false */
    showPane?: boolean;
}
```

## 事件

```ts
interface RunListEmits {
    /** 点了 pane 号（普通左键）：去会话页看这一格，`/live/sessions?pane=<pane>`；带修饰键的点击交给浏览器 */
    navigate: [href: string];
}
```

没有插槽与 expose。命令行过长时截断，悬停看全文。
