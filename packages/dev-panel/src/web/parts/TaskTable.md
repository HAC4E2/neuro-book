---
标签: []
---

# TaskTable

Work 页的 Task 表（t03 第三轮 Work 页）：每行一个 Task，列出状态、当前情况（README“当前状态”一节的第一行）、最近更新、产物数、待答数、记录来源与谁在动。行里的 Task 名是按钮，打开 Task 页。

## 数据

```ts
interface TaskTableProps {
    /** Work 里的 Task（`/api/work` 的 `tasks`）；必填 */
    tasks: TaskView[];
}
interface TaskTableEmits {
    /** 点 Task 名 */
    (event: "open", taskId: string): void;
}
```

没有插槽与 expose。底层是 nb-ui 的 `Table`：窄容器下表格横向滚动，页面不变宽。没有字段的值显示“未标”。
