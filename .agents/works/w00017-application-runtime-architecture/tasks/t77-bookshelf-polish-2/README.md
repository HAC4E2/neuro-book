---
schema: nbook.task/v2
taskId: t77-bookshelf-polish-2
---

# 书架打磨二：对话框合并、新建窗口与取色

## 目标与范围

开发者 2026-10-11 看过 t76 的结果后提出：新建入口太小、ⓘ 按钮不好看、取色器要做成通用组件并重做外观、“放在哪里”文案与控件高度、新建窗口左下空、新建窗口改为居中的模态（不能拖、点空白处关闭）、`Dialog` 与 `DialogWindow` 合并，以及 t74 审查留下的字数统计开销。开发者同意全部推荐做法，计划见 [plan.md](plan.md)：

- nb-ui：`Dialog` 合并 `DialogWindow`（缺省模态，可选浮动窗口），新增 `InfoTip`、`ColorSwatches`，`ColorPicker` 面板改用 reka 的取色原语重做；
- 书架：作品信息对话框与目录选择器改为模态，新建窗口重排（主题色挪到封面下，“保存位置”），网格末尾与列表末行的“新建作品”占位；
- 编辑器：状态栏字数停手后再算，按修订号缓存。

不做：通知的去重与数量上限、`Banner` 的使用者、品牌色进主题、`settings/commands.test.ts` 的既有失败。

行为合同：[`workbench/bookshelf.md`](../../../../../docs/specs/workbench/bookshelf.md) 输出 6、8、11–13 与新增验收；[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 27 与新增验收；nb-ui 组件文档。

## 前置

[t76](../t76-bookshelf-polish/README.md)（书架打磨一）。

## 当前状态

- 2026-10-11 建立；计划起草后交 opus 子代理只读审查：必须先改 4 条（模态浮层层级的注入方式、切片会留下坏掉的中间提交、两种用法的接口与 reka 标题警告、遮罩必须用 `DialogOverlay`）、建议 10 条，全部改进 [plan.md](plan.md)。开发者另提 z-index 集中维护，写成计划里的“层级登记与规则”。开发者确认：z-index 规则化并进 S2；旧应用不留 `DialogWindow` 兼容，接受它不能运行；开始实施。
