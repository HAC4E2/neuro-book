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

- 2026-10-11 S1 静态稿交开发者看过后提交（配色待定）：
  - nb-ui 新增 `InfoTip`、`ColorSwatches`（reka `ColorSwatchPicker` 底座，“自动”“自定义”用哨兵值，选择从色块的 `select` 事件取，因为受控时 reka 的根会把一次选择发两遍）与内部的 `ColorPickerPanel`（reka 的 `ColorArea`、`ColorSlider`、`ColorField`，按 HSB 保存当前色，明度压到 0 色相不丢）；`ColorPicker` 改用它，触发器改成真按钮（禁用时打不开），去掉原生取色与 `showInput`。两个弹层按开发者意见改用 `FormSelect` 同款的面（`useDropdownSurfaceStyle`）。`ColorPickerPanel` 是内部部件，不单独写组件文档（同 `ContextMenuPanel`），行为写在 `ColorPicker.md`、`ColorSwatches.md` 里。
  - 作品信息窗口（暂留 `DialogWindow`）：主题色挪到封面下两行五列，简介撑满右栏，“保存位置”，“浏览…”与输入框同高，ⓘ 全换 `InfoTip`；“自动”色块画 `autoBookColor(id)`（与 `book-colors.css` 同一公式，目录选择器的作品色块也改用它）。
  - 占位卡：计划里的“列表框 `display: contents`”在真实 Chrome 里拿不到焦点、Tab 跳过（无障碍树里角色还在），弃用；开发者选“占位卡作为列表框的最后一个选项”：方向键或 End 走到它不改选中，Enter 或点它新建。`BookCard` 分开“选中”（`aria-selected`）与“选中环”（新 prop `highlighted`）。列表视图末行“新建作品”。Spec `workbench/bookshelf.md` 输出 6、8 与验收 8。
  - 踩坑：reka 经 `as-child` 渲染的根带不上组件的作用域属性，作用域样式落不到它身上（色块宽度为 0）；尺寸变量改放在自己的外层 `div` 上。
  - 验证：nb-ui 35 个文件 537 例、typecheck；neuro-book typecheck，书架与 Lab 的 DOM 测试 62 例，`bun test` 项目、Lab、工作台 294 例；`bookshelf.e2e.ts`、`bookshelf-stats.e2e.ts` 6 例（新增验收 8 一例）；`lab:shot` 三个 nb-ui 组件与四个书架组件，nbook、macos × 明暗、1280 与 390，全部 0 溢出、0 光晕裁切。
  - 截图：[新建](evidences/s1-create-light.png)、[深色](evidences/s1-create-filled-dark.png)、[取色面板](evidences/s1-create-custom-panel-light.png)、[说明提示](evidences/s1-create-location-tip-light.png)、[编辑](evidences/s1-edit-light.png)、[卡片](evidences/s1-shelf-cards-light.png)、[列表](evidences/s1-shelf-list-light.png)、[手机](evidences/s1-shelf-phone-light.png)；配色候选：`evidences/s1-palette-*.png`（现在、布面精装、传统色、现代明快）。
  - 开发者另指出：从新建窗口点“浏览…”打开的选择器压在新建窗口下面（两个 `DialogWindow` 同级时按 DOM 顺序叠放），S2 改为模态按打开顺序叠放时解决。
- 2026-10-11 建立；计划起草后交 opus 子代理只读审查：必须先改 4 条（模态浮层层级的注入方式、切片会留下坏掉的中间提交、两种用法的接口与 reka 标题警告、遮罩必须用 `DialogOverlay`）、建议 10 条，全部改进 [plan.md](plan.md)。开发者另提 z-index 集中维护，写成计划里的“层级登记与规则”。开发者确认：z-index 规则化并进 S2；旧应用不留 `DialogWindow` 兼容，接受它不能运行；开始实施。
