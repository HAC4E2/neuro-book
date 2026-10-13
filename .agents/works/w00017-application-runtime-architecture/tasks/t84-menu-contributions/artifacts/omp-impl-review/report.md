# w00017 t84 菜单贡献点只读实现审查

范围：`01722510f..734e3a5cb`；先读完 66 个文件的完整 diff，再对照设计、修订后的计划、Spec、组件合同与基线。本文的 `wt/` 指报告同目录的审查 worktree。未修改检出文件；实验文件与配置均在本报告所在目录。未运行 e2e、浏览器、开发服务、构建或安装依赖。

### C1 入口开始停止时不会使响应式菜单失效，现有寿命测试刻意绕过了缓存

- **严重程度**：重要
- **类别**：不变量／交互时序／测试
- **位置**：`wt/packages/neuro-book/src/plugins/commands/shared/menus.ts:125-154`；`wt/packages/neuro-book/src/plugins/workbench/titlebar-menu.test.ts:178-192`。
- **现象**：菜单项的 `handle.published` 在入口开始停止时已变为 false，但它不是响应式字段；注册表只在 `published`、`revoke` 和拥有者停止时增加版本。先读过的 computed／界面渲染不会因此重算，仍保留停止中的贡献方菜单，直到该项真正收到 `revoke`。引用其它插件命令的菜单项尤其不能靠命令撤回触发刷新。
- **为什么是问题**：`menus.md` 的“时序与寿命”承诺入口开始停止就不再显示，而不是等异步撤回结束。内核撤回受接收者串行锁、逆序逐项异步撤回控制，二者不是同一个时刻。新增合同测试在第 186 行明确选择“直接求值”，因此只证明重新调用能过滤，没有证明产品依赖的响应式显示会失效。base 没有菜单贡献注册表，本次引入。
- **如何核实**：已运行 `bun test ../menu-lifecycle-probe.test.ts`（在 `wt/` 执行）。用真实 `createRuntimeInstance`、`createPluginHost`、贡献接收者与产品 `MenuItemRegistry`，先缓存 `computed(() => registry.items())`，再关闭贡献方真实激活作用域。输出 `{"direct":[],"cached":["test.source.item"]}`；1 pass，0 fail，8 个断言；撤回完成后缓存才变空。未在浏览器中复现。浏览器核实方式：菜单仅贡献方引用其它插件仍存活的命令，打开标题栏菜单后停止贡献方，核对开始停止至撤回期间条目是否消失。
- **建议改法**：在贡献方开始停止时产生可订阅的失效信号并同步推进注册表版本；若内核句柄没有此能力，补充明确的入口状态订阅，而非假定 getter 会通知 Vue。把寿命测试改为缓存后的响应式观察，覆盖菜单与命令分属不同入口，以及异步撤回期间。

### C2 按钮溢出分流破坏自有动作优先与贡献项的节排序

- **严重程度**：重要
- **类别**：正确性／合同
- **位置**：`wt/packages/neuro-book/src/ui/menus/title-actions.ts:38-44`；`wt/packages/neuro-book/src/plugins/editor/title-actions.test.ts:71-75`。
- **现象**：所有超预算的 inline 项被扁平化后放进“⋯”第一节，先于拥有者自己的 menu 动作；不同贡献节的溢出项混到同一节，原本同节的显式 menu 项却放在后面的另一节。例如编辑器自己的按钮加四个贡献按钮时，第四个贡献按钮出现在“用其它编辑器重新打开”之前。视图标题也走同一个函数。
- **为什么是问题**：`views.md` 输出 11、`editor.md` 输出 34 都要求拥有者自己的动作在前、贡献的在后；`menus.md` 输出 4、7 要求“⋯”仍按 section/order 排序、节间一条分隔线。达到已规定的按钮预算就是正常场景，不应改变命名节的语义。现有测试反而把贡献的 b3 在自有 reopen-with 前面固定成正确答案。base 无“⋯”与溢出分流，本次引入。
- **如何核实**：已运行 `bun test ../title-model-probe.test.ts`。直接执行产品的纯函数，以一个自有 menu 动作、两节贡献（每节各有 inline 与 menu）以及预算 1 输入，实际节序为 `[["extra:a","extra:b"],["own:menu"],["extra:menu-a"],["extra:menu-b"]]`；两条探针共 2 pass、0 fail、4 个断言。这是呈现模型的确定性结果，未在浏览器中复现。
- **建议改法**：预算仅决定哪些项留在按钮区，不另造优先于所有其它项的溢出节。各来源内保留原始顺序与节身份，剩余自有项先成为菜单自有节，再把各贡献节的溢出与显式 menu 项合并，空节去掉。修正现有预算测试的期望，并覆盖同节交错的 inline/menu 及跨节溢出。

### C3 两处标题“⋯”都丢失命令声明的快捷键

- **严重程度**：建议
- **类别**：正确性／合同
- **位置**：`wt/packages/neuro-book/src/plugins/workbench/web/titlebar/titlebar-source.ts:155-163`；`wt/packages/neuro-book/src/plugins/editor/web/title-actions.ts:82-89`；`wt/packages/neuro-book/src/ui/menus/title-actions.ts:7-18`；`wt/packages/neuro-book/src/ui/menus/TitleActions.vue:24-33`。
- **现象**：`arrangeMenu` 已输出平台化的 `shortcut`，但视图与编辑区标题的映射不保留它，`TitleActionEntry` 也没有该字段，最终没有交给已支持 `shortcut` 的 nb-ui Dropdown。给命令声明 `Mod+P`、菜单项声明 `placement: "menu"` 时，“⋯”中只显示标题；超预算 inline 项同样丢失。
- **为什么是问题**：`menus.md` 输出 2 明确快捷键取命令声明、按平台写法，四处位置复用同一合同；标题栏和资源管理器保留了它，这两处却静默收窄合同。base 没有这两处菜单，属于新能力缺口，不是旧按钮缺少快捷键提示的回归。
- **如何核实**：已运行 `bun test ../title-model-probe.test.ts`，用真实命令注册表登记 `Mod+P`，共同模型输出 `shortcut: "Ctrl+P"`，产品 `createEditorTitleActions` 的菜单模型没有 `shortcut` 属性；2 pass、0 fail、4 个断言。视图侧同样的丢字段已对照代码核实。未在浏览器中复现；浏览器可直接给测试命令加键位、打开两处“⋯”核对右侧提示。
- **建议改法**：在共享标题呈现模型保留 shortcut，贡献映射与自有动作从命令元数据取得，渲染 DropdownItem 时传入；补菜单项以及溢出项的快捷键展示断言。

### C4 编辑组可以比固定动作区更窄，右侧“⋯”被裁掉且标签条没有可用宽度

- **严重程度**：重要
- **类别**：正确性／布局边界／测试
- **位置**：`wt/packages/neuro-book/src/plugins/editor/web/components/EditorGroup.vue:116-136,193-207`；`wt/packages/neuro-book/src/ui/menus/TitleActions.vue:76-80`；`wt/packages/neuro-book/src/plugins/editor/web/components/EditorArea.vue:35-36,73-74`；`wt/packages/neuro-book/e2e/editor-area.e2e.ts:776-783`。
- **现象**：编辑区标题始终最多保留 4 个 inline 按钮，并不按组的实际宽度让位；动作区 `flex: 0 0 auto`，按钮也 `shrink-0`。自有拆分按钮加三个贡献按钮、再加“⋯”，仅按钮就需 120px，尚未算间距与内边距。390px 的编辑区连续向右拆分两次，活动组允许只有 97.5px，标题动作仍全部留在这组，标签条被挤到零，“⋯”超出叶／编辑区的裁切盒。
- **为什么是问题**：四按钮预算只防数量失控，不保证正常分组与拖动缩窄时核心操作可达；`ui-development-spec.md` 第 3 节要求窄屏不能隐藏完成核心操作所需的控件，`editor.md` 输出 34 要求标签滚动且标题动作可使用。base 标签条自己占组宽并横向滚动，本次新增不收缩的固定轨道后产生此下限。新窄屏用例只开一个组、只贡献一个按钮；虽然标题声称“最后一个标签都在视口里”，正文完全没有测标签，也没有测满按钮预算或窄编辑组。
- **如何核实**：已运行 `bun test ../title-model-probe.test.ts -t '390px'`，真实 `createEditorGroups` 两次 split 与公开 grid.layout 得到活动组 `width: 97.5`、`minimumSize.width: 0`；1 pass、0 fail、2 个断言。24px 与不收缩分别由 `IconButton.vue:35-37,69` 核实。裁切影响从布局代码推断，**未在浏览器中复现**。浏览器核实方式：装三个 editor.title inline 贡献，在 390px 页两次拆分或拖活动组至小于 120px，量标题动作与组的矩形，点“⋯”并核对活动标签与关闭按钮是否可滚到完整可见。
- **建议改法**：按活动组实际可用宽度降低 inline 预算，把放不下的动作继续收进“⋯”，至少保留菜单入口与可操作的标签区域；不要用页面 scrollWidth 没增长代替叶内可达性。窄屏验收补满预算、多组／缩窄状态，并量标签与末端菜单入口相对本组的裁切边界。

## 核实补充与验证记录

- **C1 的异步撤回补充**：`menu-lifecycle-probe.test.ts` 已增加同一贡献方的第二条贡献，其接收者用 Promise 闸门挂起逆序撤回。真实内核已进入撤回回调、让出事件循环后，菜单仍输出 `{"direct":[],"cached":["test.source.item"]}`；放行撤回后才刷新。最新命令 `bun test ../menu-lifecycle-probe.test.ts`：1 pass、0 fail、8 个断言。这不是只在 close() 同步返回前的短瞬间观察，也没有模拟 published getter。

以下命令在 `wt/packages/neuro-book/` 执行，除另有说明：

| 命令 | 本次实际结果 |
|---|---|
| `bun test ./src/plugins/commands/shared/menus.test.ts ./src/plugins/workbench/titlebar-menu.test.ts ./src/plugins/workbench/web/titlebar/menu-model.test.ts ./src/plugins/workbench/view-actions.test.ts ./src/plugins/editor/title-actions.test.ts ./src/architecture.test.ts` | 23 pass、0 fail、95 个断言；含依赖方向门禁 |
| `bun run typecheck` | 退出码 0；执行 tsc 与两组 vue-tsc，83.16 秒 |
| `bun x vitest run --config ../../../vitest.app.config.mts src/ui/menus/TitleActions.dom.test.ts src/plugins/workbench/web/components/WorkbenchTitleBar.dom.test.ts src/plugins/workbench/web/components/WorkbenchShellParts.dom.test.ts src/plugins/explorer/web/components/FilesExplorerActions.dom.test.ts` | 4 个文件、30 个测试通过 |
| `bun x vitest run --config ../../../vitest.nb-ui.config.mts src/components/feedback/ContextMenu.test.ts`（在 `wt/packages/nb-ui/`） | 1 个文件、4 个测试通过 |
| `bun test ../title-model-probe.test.ts`（在 `wt/`，增加几何探针之前） | 排序、快捷键两条探针，2 pass、0 fail、4 个断言 |
| `bun test ../title-model-probe.test.ts -t '390px'`（在 `wt/`） | 几何探针 1 pass、0 fail、2 个断言；另两条被命令过滤 |

外部 Vitest 配置只调整缓存路径、保留 symlink 解析，并把同一份测试支持 setup 指到本检出；没有更改测试断言或产品逻辑。最初配置路径多写一级，后续 `.ts` 外部配置触发 UnoCSS 的 CJS/ESM 装载问题与 symlink 测试支持路径错误，均为审查配置问题；改用报告同目录的 `.mts` 与上述配置后成功，不记为产品缺陷。

按要求未运行 e2e、真实浏览器、开发服务、构建、安装依赖；不能由 happy-dom 证明的裁切、可达性与真实焦点行为仍须用各问题列出的浏览器场景核实。未将旧验证证据计入本次通过数。

- **C3 的实际组件补充**：已运行 `bun x vitest run --config ../../../vitest.app.config.mts ../../../title-shortcut.dom.test.ts`（在 `wt/packages/neuro-book/`）。用真实命令注册表与 `createEditorTitleActions` 生成模型，挂载产品 `TitleActions.vue`，经 ArrowDown 真正打开 nb-ui Dropdown；命令已声明 `Mod+P`，可见菜单项文字只有“预览”、没有 `Ctrl+P`。1 个文件、1 个测试通过。此为 happy-dom 实际组件路径，不是浏览器布局验证。

## 各级数量

| 严重程度 | 数量 | 编号 |
|---|---:|---|
| 阻断 | 0 | 无 |
| 重要 | 3 | C1、C2、C4 |
| 建议 | 1 | C3 |
| 合计 | 4 | C1–C4 |

自查：在报告目录执行 `grep -c '^### C' report.md`，实际输出 `4`；标题 C1–C4 连续，与逐条严重程度及上表一致。
