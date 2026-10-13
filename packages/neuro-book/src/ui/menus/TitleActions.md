---
标签: []
别名: ["视图标题动作", "View Title Actions"]
---

# WorkbenchViewActions

视图的标题动作（[`workbench/views.md`](../../../../../../../docs/specs/workbench/views.md) 输出 10、11）：一排 24px 的图标按钮（`IconButton` 的 `xs`）加末尾的“⋯”下拉，放在 32px 的标题行里。multiple 时在视图标题的动作区，single 时由宿主上提到容器标题行或面板的标签带旁，排在“移动到”之前（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 输出 17 的动作顺序）。按钮与“⋯”里有什么、怎样排（视图自己的在前、别的插件经 `workbench.view-title` 贡献的在后，按钮至多 8 个）由外壳算好（`ShellChrome.viewActions`）交来。

## 数据

```ts
type Props = {
    /** 外壳算好的动作：按钮一排，“⋯”里按节分好；每项有稳定的 key、标题、图标、不可用的原因与按下态。 */
    model: ViewActionsModel;
    /** 菜单身份（视图、所在容器与模式、交付状态、代际）：变了就关掉打开着的“⋯”。 */
    identity: string;
    /** “⋯”的可访问名称，例如“更多操作”。 */
    moreLabel: string;
};

type Emits = {
    /** 点了哪个动作：它的 key（视图自己的是 `own:<序号>`，贡献来的是贡献 id），由宿主按 key 找回动作执行。 */
    run: [key: string];
};
```

无 slots、无 expose；attrs 落在根 `span`。

## 交互

- 按钮的可访问名称是动作标题；悬停提示是标题，不可用时是命令给出的原因，按钮禁用。声明了 `toggled` 的动作是开关：`aria-pressed` 跟着公开状态。
- “⋯”是 nb-ui `Dropdown`（紧凑档）：节之间一条分隔线；有按下态的项画成勾选项，不可用的项禁用、`title` 是原因。`model.menu` 为空时不画“⋯”。
- “⋯”打开时记下 `identity`；之后 `identity` 变了（切换了容器、视图换代、交付状态变化），菜单关闭，之前的选择不发 `run`。这与“移动到”菜单同一规则。
- 点击发 `run`，由宿主执行命令；组件不认识命令，也不记状态。

每个按钮带 `data-view-action="<命令 id>"` 与 `data-view-action-key="<key>"`，“⋯”带 `data-view-actions-more`。
