---
标签: [state:local, env:portal]
别名: ["作品信息窗口", "新建作品"]
---

# ProjectInfoWindow

新建作品与编辑作品信息共用的浮动窗口（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 11、13）：`DialogWindow`，700px 宽，不遮罩、可拖动。只收集与校验输入：书名必填、至多 80 个字符；简介至多 500 个字符；主题色是 `#rrggbb` 或自动。提交交给宿主。

## 布局

左栏：封面位 [`BookCover`](BookCover.md)（150px，有图显示图，没图按当前书名与主题色实时排一张）、“上传封面…”（有封面时“换封面…”与“移除封面”）、说明图标里写格式与上限；下面是主题色：标签加说明图标，`ColorSwatches` 两行五列（“自动”、八档色板、“自定义”）。“自动”色块画的就是封面现在用的那个自动色；“自定义”在旁边打开取色面板。主题色改的就是封面，放在封面下面，改了立刻看到。

右栏：书名（计数只在超过上限八成时出现在标签右边）、简介（占位写它显示在哪；输入框占满右栏剩下的高度，两栏底部对齐）、保存位置（只在新建时：目录输入框，由书名生成的文件夹名作为灰色后缀实时变化；“浏览…”与输入框同高，开目录选择器；说明图标里写目录不存在会一并创建）。页脚取消与确认（新建时“新建”，编辑时“保存”）。

说明都在标签旁的 `InfoTip` 里，不占行（规范：元信息走 tooltip）。容器窄于 560px 时两栏改为上下排。

## 交互

- 打开时按 `initial` 重置输入与校验结果；回车提交。
- 确认先在本地校验，不过的字段在 `FormField` 上显示原因，不发 `submit`。服务端针对字段的拒绝由宿主经 `fieldErrors` 放回字段下。
- 选封面文件时本地先按类型与大小拒绝（只收 PNG、JPEG、WebP，至多 5 MB），通过的用对象 URL 预览；提交时随 `cover` 交出。
- `busy` 时禁止提交与关闭，输入控件禁用。取消、Escape 与关闭按钮都发 `cancel`，由宿主关闭。

## 数据

```ts
type ProjectCoverChange = {kind: "keep"} | {kind: "set"; file: File} | {kind: "remove"};
type Props = {
    locale: DisplayLocale;
    open: boolean;
    mode: "create" | "edit";
    initial?: {title: string; description: string; color: string | null; coverSrc?: string | null; id?: string};
    busy?: boolean;
    /** 新建时作品放在哪个目录下（受控）。 */
    location?: string;
    fieldErrors?: Partial<Record<"title" | "description" | "location", string>>;
};
type Emits = {
    submit: [values: {title: string; description: string; color: string | null; parent: string | null; cover: ProjectCoverChange}];
    cancel: [];
    "update:location": [path: string];
    "browse-location": [];
};
```

`submit` 的 `title`、`description` 已去掉首尾空白；`color` 是小写的 `#rrggbb` 或 null；`parent` 去掉了末尾的分隔符，编辑时为 null。

根节点是 `DialogWindow` 的 Teleport：不透传 attrs。表单带 `data-project-info`，字段 `data-project-title`、`data-project-description`、`data-project-color`（色板外层，色块是其中的 `data-color-swatch`）、`data-project-location-input`，封面 `data-project-cover-pick`、`data-project-cover-input`，页脚 `data-project-confirm`、`data-project-cancel`。

## 隐藏通道理由

`state:local`：输入、本地校验结果与封面预览的对象 URL 随本次打开。`env:portal`：浮动窗口经 `DialogWindow` 传送到宿主目标。

## 不支持

不自己调远程服务，不记住上次的输入，不裁剪封面。
