---
标签: ["state:local"]
---

# AnswerForm

产物页侧栏的答复表单（t10）：每道活的题（未答与已答，不含已撤回与已取代的）给控件，单选、多选、文字、确认各一种；每题可以加说明，整份答复可以写备注。已答的题预填现在的取值，只交改过或新填的题与写了说明的题。取值按核心的 `validateAnswerValue` 与控制字符规则当场校验（同一份规则，不复制）。零件不发请求，按“提交”只发 `submit`。

## 数据

```ts
interface AnswerFormProps {
    /** 当前看的那一版的题与状态（`/api/artifact` 的 `questions`）；必填 */
    questions: QuestionState[];
    /** 提交中：控件与按钮禁用；必填 */
    pending: boolean;
    /** 提交超过 2 秒还没回来：显示“在等别的写入完成”；必填 */
    slow: boolean;
    /** 不能答的原因（主工作区不能写、来自分支、产物已关闭、看的不是最新一版）；有值时表单只读并显示原因；必填，可为 null */
    disabledReason: string | null;
    /** 服务端按题号退回的错误；必填 */
    errors: Record<string, string>;
    /** 变了就清空本地的填写（提交成功之后由页面加一）；必填 */
    resetKey: number;
}
interface AnswerFormEmits {
    /** 按下提交；`values` 只含改过或新填的题 */
    (event: "submit", answer: {values: Record<string, unknown>; comments: Record<string, string>; note: string | null}): void;
}
```

没有插槽与 expose。没有任何题能交时提交按钮禁用，旁边写“还没有改任何一题”。

## 注意事项

只写了说明、没改取值的已答题，交的时候带上现在的取值：答复文件里每道题都有取值，说明不会挂在一道没有取值的题上。
