---
标签: ["state:local"]
---

# StatusSwitch

Work 页与 Task 页的状态切换（t10）：平时只是一个“改状态”的 ghost 按钮，状态本身由页头标题旁的 `StatusChip` 显示，页面上只显示一处（t15 阶段 4 第 2 批；以前下拉一直显示着现在的状态，和徽标重复）。点了才出下拉，旁边一个“取消”；下拉选了不立即写，先在原地确认一次（“把 t09 改成完成？”），确认后发 `confirm`，由页面发请求。不能切换时（主工作区不能写、记录来自分支）只显示原因，不出下拉。

## 数据

```ts
interface StatusSwitchProps {
    /** 现在的状态取值；没有字段或不合规时为 null（下拉显示“未标”）；必填 */
    status: string | null;
    /** 可选的取值：Work 是 active、done、shelved，Task 另有 planned；必填 */
    options: readonly string[];
    /** 确认句里的主语，例如 t09；必填 */
    subject: string;
    /** 不能切换的原因；必填，可为 null */
    disabledReason: string | null;
    /** 请求进行中；必填 */
    pending: boolean;
    /** 请求超过 2 秒还没回来；必填 */
    slow: boolean;
}
interface StatusSwitchEmits {
    /** 确认改成这个状态 */
    (event: "confirm", status: string): void;
}
```

没有插槽与 expose。`status` 变了（保存成功后页面重新取数、推送来了新状态）时收起确认与下拉，回到“改状态”按钮。`state:local` 是下拉是否打开与选中的新状态。

焦点：点“改状态”后焦点给下拉；点“取消”、或状态变了收起时，焦点原本在这块里就放回“改状态”按钮（形态切换时原来的按钮被换掉，不处理就会掉到 body）。
