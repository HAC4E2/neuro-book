---
标签: []
---

# ProcList

“在跑”页的第一块（t14）：经 `nbdev dev start` 起的服务。每行写状态（启动中、在跑、没人监管、已结束）、checkout、package、script、地址（http 与 https 才给链接，新标签页打开）、谁起的、起了多久、是哪个 Task 的、原因与日志路径。已结束的淡化显示。只读：停服务用命令行 `nbdev dev stop`，这里没有按钮。

## 数据

```ts
interface ProcListProps {
    /** `/api/runs` 的 `procs`；必填 */
    runs: ProcRunView[];
}
```

没有事件、插槽与 expose。空数组时写“没有经 nbdev 起的服务”。日志只显示路径，不提供下载。
