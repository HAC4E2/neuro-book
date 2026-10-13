---
标签: ["state:local"]
---

# QuestionPanel

产物页右边的问题侧栏（t03 第二轮产物页）：未答的题在上（必答在前、选答在后），逐题列出题目、类型、选项（推荐的标出来）、是否必答；已答的收起，展开后看取值、针对哪一版与说明；作废的旧答复（选项后来改了，或取值本身不合法）在题下标出；被取代与撤回的题再折一层。它只显示，答题在上面的 `AnswerForm`（t10）；有表单时不再重复列未答的题。

## 数据

```ts
interface QuestionPanelProps {
    /** 当前显示的那一版的题与状态（`/api/artifact` 的 `questions`）；必填 */
    questions: QuestionState[];
    /** 显示的是第几版；必填 */
    version: number;
    /** 最新一版；必填。不是最新时顶上写“看的是 vN 的题表” */
    latestVersion: number;
    /** 上面有答复表单：不列“未答”一组，也不写版本提示（表单里有）；默认 false */
    answering?: boolean;
}
```

没有事件、插槽与 expose。`state:local` 是“已答”“已取代与撤回”两组的展开状态，组件销毁即丢。

## 布局

纵向一列，宽度随父容器；题多时由父容器滚动（本组件不另开滚动）。390 宽时它在 iframe 下面，占满一列。
