---
标签: [state:local, env:portal]
别名: ["作品信息对话框", "新建作品"]
---

# ProjectInfoDialog

新建作品与编辑作品信息共用的模态对话框（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 11、13）。只收集与校验输入：书名必填、至多 80 个字符；简介至多 500 个字符；主题色是 `#rrggbb` 或不指定。提交交给宿主，服务端拒绝的原因由宿主经 `error` 显示在表单下方，对话框保留输入。

## 布局

`Dialog` 的 `md` 尺寸；正文是一列表单：书名、简介（三行）、主题色，新建时再加一行“位置”。页脚是取消与确认（新建时写“新建”，编辑时写“保存”）。主题色一行：没指定时只有一个“指定主题色…”按钮（取色器总会显示一个回退色，画出来像已经选了，所以不画）；点了之后是取色器、当前色值与“不指定”。

“位置”一行（只在新建时）：等宽字显示 `作品目录/文件夹名`，文件夹名随书名实时生成（书名空着时写 `<书名>`），父目录淡色、文件夹名正色；右边“更改…”发 `change-location`，由宿主开路径输入。没有作品目录（`library` 为 null）时写“还没有作品目录，新建前先选一个”，按钮改为“选择…”。

## 交互

- 打开时按 `initial` 重置输入与校验结果，书名自动聚焦；回车提交。
- 确认先在本地校验，不过的字段在 `FormField` 上显示原因，不发 `submit`。
- `busy` 时禁止提交与关闭，输入控件禁用。
- 取消、Escape 与遮罩都发 `cancel`，由宿主关闭。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    open: boolean;
    mode: "create" | "edit";
    initial?: {title: string; description: string; color: string | null};
    busy?: boolean;
    /** 服务端拒绝的原因，已按当前语言写好。 */
    error?: string;
    /** 新建时作品会建在哪个目录下；null 表示还没设。编辑时不用。 */
    library?: string | null;
};
type Emits = {
    submit: [values: {title: string; description: string; color: string | null}];
    cancel: [];
    /** 用户要换作品目录。 */
    "change-location": [];
};
```

`submit` 的 `title`、`description` 已去掉首尾空白；`color` 是小写的 `#rrggbb` 或 null。

根节点是 `Dialog` 的 Teleport：组件不透传 attrs（`inheritAttrs: false`），`class` 与 `data-*` 不会出现在任何节点上。

## 不支持

不自己调远程服务，不记住上次的输入；封面图不在本期。
