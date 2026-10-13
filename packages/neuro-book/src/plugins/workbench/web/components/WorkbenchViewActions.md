---
标签: []
别名: ["视图标题动作", "View Title Actions"]
---

# WorkbenchViewActions

视图贡献的标题动作（[`workbench/views.md`](../../../../../../../docs/specs/workbench/views.md) 输出 10）：一排 24px 的图标按钮（`IconButton` 的 `xs`），放在 32px 的标题行里。multiple 时在视图标题的动作区，single 时由宿主上提到容器标题行或面板的标签带旁，排在“移动到”之前（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 输出 17 的动作顺序）。

## 数据

```ts
type Props = {
    /** 外壳算好的动作（`ShellChrome.viewActions`）：标题、不可用的原因、按下态。 */
    actions: ReadonlyArray<ViewActionEntry>;
};

type Emits = {
    /** 点了第几个动作。 */
    run: [index: number];
};
```

无 slots、无 expose；attrs 落在根 `span`。

## 交互

- 按钮的可访问名称是动作标题；悬停提示是标题，不可用时是命令给出的原因，按钮禁用。
- 声明了 `toggled` 的动作是开关：`aria-pressed` 跟着公开状态。
- 点击发 `run`，由宿主按声明执行命令；组件不认识命令，也不记状态。

每个按钮带 `data-view-action="<命令 id>"`。
