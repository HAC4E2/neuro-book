---
标签: []
---

# NewTaskForm

新建 Task 的表单（t10）：所属 Work、短名、标题、目标与范围（可选）、状态（计划中或进行中）。来自分支的 Work 也可以选：新 Task 与命令行一样写进 master；Work README 还没提交时服务端报 `work_not_committed`。

## 数据

```ts
type TaskFormValue = {workId: string; slug: string; title: string; goal: string; status: "planned" | "active"};
interface NewTaskFormProps {
    /** 表单的值；必填、受控 */
    modelValue: TaskFormValue;
    /** 可选的 Work；必填 */
    works: Array<{workId: string; title: string | null}>;
    problems: PreviewProblem[];
    pending: boolean;
    slow: boolean;
    disabledReason: string | null;
}
interface NewTaskFormEmits {
    (event: "update:modelValue", value: TaskFormValue): void;
    (event: "submit"): void;
}
```

没有插槽与 expose。
