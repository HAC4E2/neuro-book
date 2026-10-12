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

- 2026-10-12 S4（收口）进行中：Lab 版面测量补强与门禁已完成，omp 实现审查待跑。
  - **测量补强**（`lab-debug.ts`）：
    - 覆盖传送到画布浮层落点的对话框与抽屉，以及 body 上开着的 reka 浮层；
    - 新增 `clippedRings`，查现在就画着的外扩环（不偏移外阴影的扩散量、outline）；
    - 焦点光晕改按实色部分算（不偏移那几圈的扩散量，nbook 与 macos 都是 3.5px）；
    - 处在无限循环动画里的元素不算越界。
  - **阈值与误报的依据**：开发者要求先截图核实。对每类被报的控件逐个用键盘方式聚焦，和“裁切容器改成不裁”对照（[总览](evidences/s4-focus-clip-overview.png)）：离边 0–2px 的环实色部分被切成平边，属实；4–5.6px 只切到外圈模糊，看不出，是误报；`Spinner` 的越界随旋转角度变，是误报。
  - **门禁**：`lab-scenes.e2e.ts` 对全部场景在手机画布上量，等字体、有限动画并隔两帧量到连续两次一致。和 `e2e/lab-layout-baseline.ts` 逐项比个数，多了少了都失败。
    - 不等稳定时，四个标签页并行，同一场景两轮结果不同；
    - 基线有 36 个场景，都是贴边控件的聚焦光晕被裁，外加 `Collapsible` 的 6px（刻意的负外边距）；
    - 开发者选“门禁带基线，另开 Task 清”，建了 [t78](../t78-lab-layout-baseline/README.md)（未开工）。
  - **Spec**：`ui/component-lab.md` 改写 `measure()` 与 `lab:shot` 的说明，追加验收 26、27。
  - **验证**：
    - `lab-shot.e2e.ts` 4 例（验收 25 加离边 5px 不报，验收 26 新增）；`lab-scenes.e2e.ts` 连跑三轮结果一致、带基线通过；
    - 变异 5 处全部被 e2e 抓到：不看画布浮层、偏移投影也算环、不看 outline、转圈也算越界、焦点环按旧的 7px；
    - `test:affected --typecheck --since daf159b4`：两包 typecheck 为 0，nb-ui 与 vitest 全过；`bun test` 982 过、2 失败。一个是已知的 `settings/commands.test.ts`，另一个是 `settings/backend/layer-owner.test.ts` 的“合并：静止 50 毫秒才重读”，在机器忙时超时，单跑 3 次都过，该文件自 t68 未动；
    - `docs:check`、`governance:check` 无失败；全量 e2e 161 例全过。
- 2026-10-12 S3 完成：状态栏字数换活动文档或文档还没算过时立即算；同一文档输入时先显示上一次的值，停手 300ms（注入时钟）后按当时的修订号再算。按文档缓存修订号与字数，计时只在待算的修订号变了时重排（状态栏移动光标也会求值）。Spec `workbench/editor.md` 输出 27 改写，追加验收 16。验证：`status-items.test.ts` 5 例（`ManualClock`：到点前显示旧值、反复求值不推迟、到点经响应式刷新、换文档与新开立即显示），编辑器测试 85 例，typecheck 0；变异 5 处全部被抓到。
- 2026-10-12 开发者认为 S2 可以了，接着做 S3、S4。问到 e2e 是否管“内层边框被外层截断”这类问题：不管，它验行为；外观靠 `lab:shot` 的测量，而测量对对话框没生效（见上一条的更正）。开发者选把测量补强并进 S4，含 e2e 门禁（[plan.md](plan.md) 末尾）。
- 2026-10-11 S2 完成：
  - **`Dialog` 合并 `DialogWindow`**：缺省模态（reka 模态 Dialog、遮罩用 `DialogOverlay`），`modal=false` 是浮动窗口（拖动与缩放搬进 `useFloatingWindow`）。删 `DialogWindow`，旧应用按开发者选的 (a) 不留兼容。
    - 点遮罩要按下与松开在同一个遮罩上、同一个键；对话框里开着浮层时只关浮层。
    - Esc 只关最上层，组字时与内层已处理的不算。
    - 模态按打开顺序叠放（`useModalLayer`，`AlertDialog` 共用），两种用法都向内容提供浮层层级。
    - Lab 画布声明 `contained`，模态只在画布里遮罩、不锁整页。
    - 正文四边留一圈给外扩光环（色块选中环、焦点环之前被滚动容器裁掉）。
  - **层级登记**：数值只在 `theme/z-index.ts`。拖影、落点、Lab 检查框改为引用登记表，离线横幅保留字面量并加注释。规则写进 `ui-development-spec.md` 的“叠放层级”，`z-index.test.ts` 检查各档顺序与组件里的字面量。
  - **书架**：作品信息对话框（改名 `ProjectInfoDialog`）与目录选择器改为模态。没改过时点遮罩关闭，打开时焦点在书名；“浏览…”打开的选择器叠在上面，Esc 与点遮罩只关它，焦点回到“浏览…”。
  - **开发者看过界面后追加**（记在 [plan.md](plan.md) 末尾）：
    - 色板换更亮的八色；
    - 固定列数的色板撑满所在宽度，左栏与封面同宽；
    - 表单校验不在字段下插字：开发者选“禁止提交 + 页脚状态行”，并写成通用规范（`ui-development-spec.md`“表单与无障碍”第 8 条）。`Dialog` 新增 `status` 与 `status` 插槽，`FormField` 的 `error` 只标红、交给读屏。书名空着或没有保存位置时“新建”不可用；服务端的字段拒绝把字段标红并聚焦，原因写在状态行；目录选择器的登记失败替下“已选 …”。
  - **e2e 暴露的两个真问题**：
    - 在“自定义”取色面板里第一次改值，选中项会从“自动”变成“自定义”。reka 的 Listbox 见到外部改动就把焦点移到选中项，面板因此关掉，拖色相条拖到一半面板就没了。面板开着时用 reka 的 `focusable` 开关让色板不抢焦点（`injectListboxRootContext`，reka 的 ListboxFilter 用的同一个开关）；面板经 Esc 关上后焦点回到“自定义”。
    - nb-ui `Tooltip` 的 `disabled` 不撤悬停时已排好的延时打开：点“自定义”后提示过 300ms 冒出来，压在面板上接走 Esc。改为受控开合，禁用时关上并拒掉迟到的打开。
  - **Spec**：`workbench/bookshelf.md` 输出 11–13、失败表、验收 3 改写，追加验收 9。提案追加 2026-10-11 决策记录。
  - **验证**：
    - nb-ui 37 个文件 548 例，两个 typecheck 为 0；neuro-book vitest 38 个文件 164 例；`bun test` 982 例通过，1 例是已知的 `settings/commands.test.ts`。
    - 全量 e2e：第一次 159 过、1 失败（新验收 9），查出上面两个问题；修后单例重复 12 次全过，重跑全量 160 例全过。
    - 变异检查 19 处全部被测试抓到（遮罩、Esc、初始焦点、状态行、叠放顺序、模态浮层层级、`FormField`、层级字面量与顺序、作品信息的关闭规则、提交门槛、聚焦与状态行、色板焦点、Tooltip 禁用），其中两处在 e2e 层验证。
    - `lab:shot`：`Dialog`、`ProjectInfoDialog`、`PathPickerDialog`、`ColorSwatches`，nbook、macos × 明暗 × 1280 与 390，共 184 张，报告 0 问题。（2026-10-12 更正：对话框传送到了舞台外，测量只测舞台里面，这几个组件的越界与裁切两项其实没测到；色板选中环被裁也不在检查范围内。补强并进 S4。）
  - **截图**：[新建](evidences/s2-create-light.png)、[深色](evidences/s2-create-dark.png)、[服务端拒绝](evidences/s2-create-rejected-light.png)、[选择器登记失败](evidences/s2-picker-rejected-dark.png)、[手机](evidences/s2-create-phone-macos-light.png)、[书架新配色](evidences/s2-shelf-cards-light.png)。
- 2026-10-11 配色定稿（开发者同意推荐）：作品色板换成“布面精装”八色（藏青、墨绿、酒红、赭石、黛紫、青瓷、驼色、炭黑），定义在 `shelf-format.ts` 的 `BOOK_PALETTE` 一处；没指定颜色的作品按 id 从这八色里取（`bookPaletteIndex`、`autoBookColor`），“自动”与色板同一套颜色，不再按主题强调色转色相，删去 `book-colors.css`。`ColorSwatches` 的 `colors` 接受只读数组。Spec 输出 5 同步。验证：typecheck；`bun test` 项目 63 例、DOM 62 例；书架 e2e 6 例。截图：[卡片](evidences/s1-cloth-shelf-cards-light.png)、[深色](evidences/s1-cloth-shelf-cards-dark.png)、[列表](evidences/s1-cloth-shelf-list-light.png)、[新建](evidences/s1-cloth-create-light.png)。
- 2026-10-11 S1 静态稿交开发者看过后提交（配色待定）：
  - nb-ui 新增 `InfoTip`、`ColorSwatches`（reka `ColorSwatchPicker` 底座，“自动”“自定义”用哨兵值，选择从色块的 `select` 事件取，因为受控时 reka 的根会把一次选择发两遍）与内部的 `ColorPickerPanel`（reka 的 `ColorArea`、`ColorSlider`、`ColorField`，按 HSB 保存当前色，明度压到 0 色相不丢）；`ColorPicker` 改用它，触发器改成真按钮（禁用时打不开），去掉原生取色与 `showInput`。两个弹层按开发者意见改用 `FormSelect` 同款的面（`useDropdownSurfaceStyle`）。`ColorPickerPanel` 是内部部件，不单独写组件文档（同 `ContextMenuPanel`），行为写在 `ColorPicker.md`、`ColorSwatches.md` 里。
  - 作品信息窗口（暂留 `DialogWindow`）：主题色挪到封面下两行五列，简介撑满右栏，“保存位置”，“浏览…”与输入框同高，ⓘ 全换 `InfoTip`；“自动”色块画 `autoBookColor(id)`（与 `book-colors.css` 同一公式，目录选择器的作品色块也改用它）。
  - 占位卡：计划里的“列表框 `display: contents`”在真实 Chrome 里拿不到焦点、Tab 跳过（无障碍树里角色还在），弃用；开发者选“占位卡作为列表框的最后一个选项”：方向键或 End 走到它不改选中，Enter 或点它新建。`BookCard` 分开“选中”（`aria-selected`）与“选中环”（新 prop `highlighted`）。列表视图末行“新建作品”。Spec `workbench/bookshelf.md` 输出 6、8 与验收 8。
  - 踩坑：reka 经 `as-child` 渲染的根带不上组件的作用域属性，作用域样式落不到它身上（色块宽度为 0）；尺寸变量改放在自己的外层 `div` 上。
  - 验证：nb-ui 35 个文件 537 例、typecheck；neuro-book typecheck，书架与 Lab 的 DOM 测试 62 例，`bun test` 项目、Lab、工作台 294 例；`bookshelf.e2e.ts`、`bookshelf-stats.e2e.ts` 6 例（新增验收 8 一例）；`lab:shot` 三个 nb-ui 组件与四个书架组件，nbook、macos × 明暗、1280 与 390，全部 0 溢出、0 光晕裁切。
  - 截图：[新建](evidences/s1-create-light.png)、[深色](evidences/s1-create-filled-dark.png)、[取色面板](evidences/s1-create-custom-panel-light.png)、[说明提示](evidences/s1-create-location-tip-light.png)、[编辑](evidences/s1-edit-light.png)、[卡片](evidences/s1-shelf-cards-light.png)、[列表](evidences/s1-shelf-list-light.png)、[手机](evidences/s1-shelf-phone-light.png)；配色候选：`evidences/s1-palette-*.png`（现在、布面精装、传统色、现代明快）。
  - 开发者另指出：从新建窗口点“浏览…”打开的选择器压在新建窗口下面（两个 `DialogWindow` 同级时按 DOM 顺序叠放），S2 改为模态按打开顺序叠放时解决。
- 2026-10-11 建立；计划起草后交 opus 子代理只读审查：必须先改 4 条（模态浮层层级的注入方式、切片会留下坏掉的中间提交、两种用法的接口与 reka 标题警告、遮罩必须用 `DialogOverlay`）、建议 10 条，全部改进 [plan.md](plan.md)。开发者另提 z-index 集中维护，写成计划里的“层级登记与规则”。开发者确认：z-index 规则化并进 S2；旧应用不留 `DialogWindow` 兼容，接受它不能运行；开始实施。
