---
标签: []
---

# NewWorkForm

新建 Work 的表单（t10，照第三轮稿 `r3/new.html`）：短名、标题、目标、Issue（可选）、首个 Task 的短名、标题（缺省同 Work 标题）与状态（计划中或进行中）。Work 本身的状态不给选，一律进行中，与 `nbdev work new` 相同。字段的即时提示用核心的同一份规则（`SLUG_PATTERN`、标题与控制字符），服务端预览给出的问题按字段补上。

## 数据

```ts
type WorkFormValue = {slug: string; title: string; goal: string; issue: string; taskSlug: string; taskTitle: string; taskStatus: "planned" | "active"};
interface NewWorkFormProps {
    /** 表单的值；必填、受控 */
    modelValue: WorkFormValue;
    /** 服务端预览给出的问题（按 `field`）；必填 */
    problems: PreviewProblem[];
    pending: boolean;
    slow: boolean;
    /** 不能新建的原因（主工作区不能写）；必填，可为 null */
    disabledReason: string | null;
}
interface NewWorkFormEmits {
    (event: "update:modelValue", value: WorkFormValue): void;
    /** 必填字段都填了、没有问题时按下提交 */
    (event: "submit"): void;
}
```

没有插槽与 expose。
