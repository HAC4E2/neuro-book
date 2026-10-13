---
标签: []
---

# TaskTable

Work 页的 Task 表（t03 第三轮 Work 页）：每行一个 Task，列出状态、当前情况（README“当前状态”一节的第一行）、最近更新、产物数、待答数、记录来源与谁在动。行里的 Task 名是去 Task 页的真实链接（`<a href>`，地址由 `host/routes.ts` 拼），能在新标签页打开。

## 数据

```ts
interface TaskTableProps {
    /** 这些 Task 所在的 Work（拼 Task 页地址）；必填 */
    workId: string;
    /** Work 里的 Task（`/api/work` 的 `tasks`）；必填 */
    tasks: TaskView[];
}
interface TaskTableEmits {
    /** 普通左键点了一个入口；参数是面板内的地址，由页面 `router.push`。中键与带修饰键的点击交给浏览器（新标签页） */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose。底层是 nb-ui 的 `Table`：窄容器下表格横向滚动，页面不变宽。没有字段的值显示“未标”。
