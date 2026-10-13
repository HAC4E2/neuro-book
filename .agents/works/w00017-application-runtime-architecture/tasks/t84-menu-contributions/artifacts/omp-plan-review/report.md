# w00017 t84 设计与实施计划只读审查

依据为实现开始前的检出代码与现行文档；行为影响从代码推断，未运行测试、typecheck、构建或开发服务。下文仓库相对路径均以本报告同目录的 `wt/` 为根，`../plan.md`、`../design.md`、`../task-README.md` 相对该根。

### P1 共同合同丢掉固定参数，无法保留侧栏、右栏、活动栏三个菜单的行为

- **严重程度**：重要
- **类别**：正确性／合同遗漏
- **依据**：`../plan.md:17-30,35-39`；`packages/neuro-book/src/plugins/workbench/web/titlebar/menu-model.ts:15-24,129-134`；`docs/specs/workbench/commands.md:162-169`。
- **问题**：共同合同没有固定参数；计划只允许拥有者约定的 `args: "selection" | "resource" | "instance"`，其余一律 `{}`。但现有侧栏、右栏、活动栏三个条目是同一命令 `nbook.view.set-part-hidden` 分别带 `{part: "sidebar"}`、`{part: "auxiliarybar"}`、`{part: "activitybar"}`。标题栏位置没有传这些参数的途径。
- **为什么是问题**：按计划逐字搬迁后，三个入口都会打开“选择区域”，而不是切换标签所指区域；勾选仍指向三个不同区域，显示与执行脱节。因而“搬迁后逐项一致”的验收无法成立。
- **建议改法**：菜单共同合同保留可序列化的固定对象参数，并与位置参数选择器区分（例如 `args` 为固定对象，`contextArgs` 为拥有者枚举）；规定两者是否互斥。不要为三个触发面复制三条命令。加三个条目各自切换正确区域的验收，而不仅比标题与顺序。

### P2 非活动编辑组的动作会被活动组的可用性禁用，先激活再执行救不了不可点击的按钮

- **严重程度**：重要
- **类别**：正确性／局部上下文
- **依据**：`../plan.md:28-30,56-59,98`；`packages/neuro-book/src/plugins/editor/web/commands.ts:70-75`；`packages/neuro-book/src/plugins/editor/web/state.ts:38-46`；`packages/neuro-book/src/plugins/workbench/web/titlebar/titlebar-source.ts:119-127`；`docs/proposals/extensible-application-platform.md:332`。
- **问题**：编辑区菜单按“这个组的活动标签”决定地址与后缀，却仍按命令自己的全局 `when` 画可用性。现有分屏、重新打开命令要求 `nbook.editor/active`，这个键只反映全局活动组的文件与控件。两个组中 A 是文件、B 是欢迎页且 B 活动时，A 标题上的分屏与重新打开仍会被禁用。
- **为什么是问题**：用户无法点击禁用动作，计划中的“点了先把这个组设为活动组”根本不会发生。反向情况也错：A 欢迎页、B 文件且 B 活动时，A 的无参分屏项显示可用，激活 A 后执行却被拒绝。当前非活动组验收没有区分这两种状态。
- **建议改法**：在计划里明确显示与可用性的目标组口径，不在渲染时切换全局活动组。第一批编辑器动作可用目标组的局部状态判断，执行仍先激活；同时明确通用第三方命令的全局条件与目标组条件如何组合。验收增加“活动组欢迎页、非活动组文件”及相反状态，验证是否可点与实际结果。

### P3 顶层菜单声明并不随贡献方入口停止，命令存在不能替代贡献方生命周期判断

- **严重程度**：重要
- **类别**：不变量／验收合同
- **依据**：`../plan.md:31,95,104`；`packages/nb-runtime/src/plugins/contracts.ts:28-41,47-48,161-165`；`packages/nb-runtime/src/plugins/host.ts:421-427,1286-1313`；`docs/specs/workbench/commands.md:51,64`；`docs/specs/runtime/plugin-manifest.md:44,53,88`。
- **问题**：计划把“贡献方没有激活时命令不在目录里”当作普遍保证，并据此验收“贡献方停用后它的项消失”。实际顶层贡献没有入口身份、挂在插件登记作用域上，不挂在某个入口的激活作用域上；菜单可以引用别的插件的命令，也可以由无入口的纯声明插件提供。
- **为什么是问题**：例如插件 A 在顶层给 `nbook.editor.save-all` 加菜单，A 的浏览器入口未激活或已停止时，编辑器命令仍在，菜单仍显示。只测菜单与命令都由同一入口提供，会让错误的生命周期承诺看似通过；普通入口停止与禁用整个插件也被混写。顶层贡献本身符合平台合同，问题在于计划对其效果的推导。
- **建议改法**：保留纯声明模型，明确“菜单声明存活且目标命令存在才显示”；入口停止只保证该入口提供的命令被撤回，不承诺该插件所有菜单都消失。把验收分成自有命令、引用其它插件命令、纯声明插件三种；真正的插件禁用撤回声明仍按已排除的热插拔范围记录，不把它等同于入口未激活。若产品确实要求绑定某入口，先明确额外绑定合同，不能靠命令 id 推断。

### P4 视图动作的执行方仍按原声明数组下标找命令，计划只合并显示来源没有迁移执行合同

- **严重程度**：重要
- **类别**：正确性／遗漏调用方
- **依据**：`../plan.md:44-46,96`；`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchViewActions.vue:16-25`；`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShell.vue:253-259,465-466,496-497,553-554`；`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchViewActions.md:18-21`。
- **问题**：计划只写 `titlebar-source.ts` 合并两路动作、组件加“⋯”。真实执行在 `WorkbenchShell.runViewAction`，按组件上报的数字下标重新取 `catalog.get(viewId).actions[index]`；它既不知道新增贡献项，也不知道 `when` 裁剪与 inline/menu 分流后的列表。
- **为什么是问题**：外来贡献排在原动作后，其下标在原数组里不存在，点击直接无操作；若分流后重新编号，点击还可能执行另一个原动作。single 侧栏、single 面板与 multiple 三条接线都走这条路径，改显示模型不能完成贡献项执行。
- **建议改法**：S3 明确迁移 `WorkbenchShell` 三处调用与组件事件合同，使用稳定的动作身份／已解析动作而非原数组下标；自带动作与外来贡献保留不同来源身份，同一命令的两个条目也不能以命令 id 当唯一 key。验收交错的 inline/menu 与 `when` 隐藏、外来项引用相同命令，逐项核对执行的命令与参数。

### P5 新增视图“⋯”没有沿用菜单身份失效规则，会把旧菜单点击交给新视图或新代际

- **严重程度**：重要
- **类别**：不变量／交互时序
- **依据**：`../plan.md:42-46,96`；`docs/specs/ui/workbench-shell.md:106,108`；`docs/specs/workbench/views.md:120`；`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShell.vue:242-250,256-259,496-497`；`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchMoveViewMenu.vue:47-50,74-90`。
- **问题**：现行外壳要求模式、容器、首个视图或代际变化立即关闭旧菜单、拒绝过期点击。“移动到”已有身份快照与失效处理，但计划给 `WorkbenchViewActions` 加 Dropdown 时没有相应身份输入、关闭规则与验收；现有动作执行则在点击时重新取当前实例。
- **为什么是问题**：single 容器标题或面板标签旁的组件会随当前视图重用；打开 A 的“⋯”后切容器，或 A 加载失败后重试换代，旧菜单事件不能被当作 B／新代际的操作。外来贡献只拿到 `{viewId, generation}`，不能指望每个插件自行还原打开菜单时的身份。这个时序已经是外壳合同，不是额外要求热插拔。
- **建议改法**：S3 复用现有菜单身份规则，把视图、容器模式／来源、交付状态与代际作为“⋯”的身份；打开时冻结，变化时关闭并作废选择，执行不临时换成新实例。组件测试覆盖打开后换目标／换代，以及迟到选择零执行；e2e 至少覆盖 single 容器或面板切换。

### P6 开放外来 inline 动作后没有总量或让位规则，原有八项上限不再约束实际标题行

- **严重程度**：重要
- **类别**：边界／布局合同
- **依据**：`../design.md:56`；`../plan.md:44-45,56-59,110`；`packages/neuro-book/src/plugins/workbench/shared/views.ts:29-30,59`；`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchViewActions.vue:31-35`；`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchViewSection.md:14-17`；`packages/neuro-book/src/plugins/editor/web/components/EditorTabBar.md:37`。
- **问题**：`VIEW_ACTIONS_MAX = 8` 只约束单个视图自己声明的数组，新增 `workbench.view-title` 能无限追加 inline 动作；`editor.title` 也没有限额或溢出处理。计划只以产品的“一个按钮加 ⋯”判断 390px 风险，没有定义插件贡献以后放不下怎么办。
- **为什么是问题**：现有动作区 `flex: 0 0 auto`、不让位，24px 按钮必须全占宽；八个按钮本身就至少 192px，再加外来项、“⋯”、“移动到”与标题控件会持续占宽。编辑器即使让标签滚动，也不能解决固定按钮自身超过编辑组宽度。多插件向同一位置贡献正是新增能力的正常使用，不是异常输入。
- **建议改法**：明确合并后的 inline 预算与超量去向，优先沿用“放不下的收进 ⋯”而不是静默丢项；菜单项不占 inline 限额。S3 与 S5 分别覆盖自带动作加外来动作、多插件贡献，以及窄编辑组／390px 下按钮和最后一个标签都可达，不能只测第一批产品按钮。

### P7 资源管理器现有右键菜单接口装不下共同合同里的勾选与禁用原因

- **严重程度**：重要
- **类别**：接口／实现依赖遗漏
- **依据**：`../plan.md:17-28,48-52,97`；`packages/neuro-book/src/plugins/explorer/web/menu.ts:31-34`；`packages/neuro-book/src/plugins/explorer/web/components/FilesExplorerView.vue:93-95`；`packages/nb-ui/src/components/feedback/context-menu.types.ts:5-21`；`packages/nb-ui/src/components/feedback/ContextMenu.md:22-41`；`packages/nb-ui/src/components/controls/MenuNodes.vue:31-34,56-65,106-108`。
- **问题**：共同合同承诺四处都能显示 `toggled` 勾选、命令禁用原因，但 S4 只写追加贡献项。资源管理器自己的 `MenuEntry` 没有 checked/reason，组件映射只交 label/disabled/shortcut；nb-ui 的公开 `ContextMenuItem` 也没有 `type`／`checked`。纯函数算出这些值并不能让真实菜单呈现它们。
- **为什么是问题**：贡献一个开关命令时，右键菜单会丢掉勾选语义；禁用项即使有命令原因也没有提示或读屏描述。验收映射只在纯函数里验勾选与原因，S4 的实际界面验收只有后缀与地址，抓不到这段接口丢失。
- **建议改法**：S4 明确扩展资源管理器菜单呈现模型，并把原因映射到 `ContextMenuItem.title`；将 `type`／`checked` 加到 nb-ui 公开类型与组件合同即可复用已经支持勾选的 `MenuNodes`，不必另造菜单。增加真实组件上 `menuitemcheckbox`、`aria-checked`、禁用原因的断言；涉及共享组件时按 nb-ui 验收门禁安排验证。

### P8 共享菜单模块没有指定公开出口，按文件名跨插件复用会违反现有导入边界

- **严重程度**：建议
- **类别**：架构边界／实施计划
- **依据**：`../plan.md:12-14,27-28`；`docs/adr/0026-plugin-definitions-as-constants.md:25`；`packages/neuro-book/AGENTS.md:15`；`packages/neuro-book/src/architecture.test.ts:76-80,94-97`；`packages/neuro-book/src/plugins/commands/shared/contracts.ts:169-170`。
- **问题**：计划把 `menuItemProblem`、schema 与 `arrangeMenu` 放在 `commands/shared/menus.ts`，让四个位置的拥有者复用，却未说明必须经 `commands/shared/contracts.ts` 导出。`menus.ts` 不是跨插件运行时可导入的公开入口。
- **为什么是问题**：工作台、资源管理器、编辑器直接导入该模块时，类型检查可以通过，但既有 architecture 门禁会拒绝；若为通过门禁改白名单，会形成第二套插件公开入口约定。
- **建议改法**：计划补明 `menus.ts` 仅为命令插件内部模块，对其它插件需要的类型、schema 与函数经 `shared/contracts.ts` 导出，沿用已有 keybinding 的出口方式；不扩大导入白名单。各菜单位置的贡献点常量与 schema 同样经拥有者公开合同输出。

### P9 文档改动表漏掉组件合同与编辑器现有非目标，会留下相互矛盾的当前接口

- **严重程度**：建议
- **类别**：文档／合同迁移
- **依据**：`../plan.md:65-75`；`docs/specs/README.md:13-20`；`docs/specs/workbench/editor.md:18`；`packages/neuro-book/src/plugins/editor/web/components/EditorGroup.md:44-48`；`packages/neuro-book/src/plugins/editor/web/components/EditorArea.md:41-44`；`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchViewActions.md:1-2,8,18-30`；`packages/neuro-book/src/plugins/explorer/web/components/FilesExplorerView.md:38-39,69-70`。
- **问题**：S0 的“Spec 与文档改动”只有 Spec 与注册表，没有受影响的组件同名 `.md`；编辑器 Spec 只计划“新增标题菜单”，没有撤掉当前把编辑器工具栏列为非目标的约束。视图动作文档仍只描述图标按钮与数组下标事件，资源菜单文档仍只支持命令 id，编辑器组件仍写“不显示／不渲染编辑器工具栏”。
- **为什么是问题**：这是后续实现者和 Lab 使用者实际读取的组件合同；增加浮层、合并动作与带参数的右键项之后，继续按旧接口使用会丢数据或接错事件。新增规则也不能一边宣称工具栏已交付，一边仍列为非目标。
- **建议改法**：把 `WorkbenchViewActions.md`、`WorkbenchShell.md`、`FilesExplorerView.md`、`EditorGroup.md`、`EditorArea.md` 与实际改动到的 `EditorTabBar.md` 明列到相应切片，同步数据、事件、浮层通道与交互；编辑器非目标收窄为本次未做的面包屑等。共同菜单规则只在新 `menus.md` 写正文，各位置 Spec 和组件文档链接并只保留位置特有的合同。

### P10 S4 的验收依赖 S5 才建立的测试插件，且现有两组 e2e 默认不装测试外壳

- **严重程度**：建议
- **类别**：切片顺序／验收依赖
- **依据**：`../plan.md:61-63,85-86,97-98,102`；`packages/neuro-book/e2e/files-explorer.e2e.ts:75`；`packages/neuro-book/e2e/editor-area.e2e.ts:80`；`packages/neuro-book/e2e/fixtures.ts:49-52,74-80`；`packages/neuro-book/src/server/testing/fixture-entry.ts:23-28,38-44`；`packages/neuro-book/src/web/testing/e2e-main.ts:16-19`。
- **问题**：S4 自跑 `files-explorer.e2e.ts` 的新场景依赖 `test.menus`，但测试插件被放到 S5。两份现有 e2e 又都用 `startProductServer`，启动的是 `dist/server/main.js` 与产品页面；`NBOOK_TEST_PLUGINS` 的识别和装载只在测试宿主与 e2e 外壳中，给产品服务器加这个环境变量不足以加载插件。
- **为什么是问题**：S4 不能按计划单片完成新增验收；等到 S5 也必须同时补服务端描述、允许的插件 id、浏览器定义及 e2e 测试外壳启动路径，不能只新增 `src/web/testing/test.menus`。否则新增场景等不到贡献项，或者为了通过把测试插件塞进产品清单，破坏既有隔离合同。
- **建议改法**：把测试插件的描述、装载接线及 explorer 贡献提前到 S4，editor 贡献再随 S5 增加；新增场景使用已有 `startProbeServer`／测试外壳机制，并明确 env 点名。保留原产品构建 e2e 的启动方式，可另开局部 describe，避免无关既有用例全部换成源码测试宿主。

### P11 视图标题的验收写“别的插件”，测试插件设计却把视图和新增动作放在同一个插件里

- **严重程度**：建议
- **类别**：验收映射／覆盖缺口
- **依据**：`../plan.md:45,63,96`；`packages/neuro-book/src/web/testing/sample-views.ts:26-33,68-78`；`packages/neuro-book/src/plugins/workbench/shared/views.ts:80-82`；`docs/testing/README.md:12,46`。
- **问题**：验收要证明其它插件向样例视图贡献按钮与菜单项，但计划只让 `test.sample-views` 给自己拥有的样例视图加贡献；新 `test.menus` 只向 explorer 和 editor 两处贡献。视图目标与菜单贡献方身份不同的关键场景没有实际测试输入。
- **为什么是问题**：菜单条目 id 要受贡献方命名空间约束，`view` 目标却必须允许引用其它插件的视图。这与原视图声明的“id 归贡献方”校验不是同一规则；测试都用同插件身份时，误把目标视图也限制为贡献方前缀的实现仍能通过。只测外来贡献点路径，不等于测跨插件视图目标。
- **建议改法**：让 `test.menus` 或另一独立测试插件给 `test.sample-views` 的视图加动作，保留菜单 id 归贡献方、view id 归样例插件的不同身份；直接对应现有验收 96 的一句话。未知 view 的声明仍能登记但不渲染、视图尚未加载时 instance 动作不可点，可放到真实内核合同测试，不需要增加整套 e2e。

## P2 的核实补充

进一步核对 `packages/neuro-book/src/plugins/editor/web/components/EditorGroup.vue:98-99`：组根现有 `focusin`／`pointerdown` 会先激活该组。因此 P2 中“先激活根本不会发生”不能泛指鼠标路径：浏览器是否把禁用按钮的 pointerdown 送到父元素未做运行验证。已核实的缺陷是动作在初次渲染时读错组的可用性，尤其非活动文件组在活动欢迎页状态下被画成禁用，原生 disabled 按钮不进入 Tab 焦点路径；反向状态也会先显示可用再因激活欢迎页而被拒绝。P2 应以目标组可用性与键盘可达性为验收，不以未经验证的鼠标事件时序定结论，严重程度维持重要。

## 各级数量

| 严重程度 | 数量 | 编号 |
|---|---:|---|
| 阻断 | 0 | 无 |
| 重要 | 7 | P1–P7 |
| 建议 | 4 | P8–P11 |
| 合计 | 11 | P1–P11 |

自查命令：`grep -c '^### P' ../report.md`（在 `wt/` 执行），实际输出 `11`；标题编号 P1–P11 连续，严重程度逐条计数与上表一致。
