# t77 实现审查

- 审查方：omp（`@default`），一个会话，只读，独立 detached worktree，审查 `daf159b4..b28db3a1`；2026-10-12 02:09–04:43。会话内拆成书架、Lab、字数三个子审查，主会话汇总并逐条负责。
- 结果：5 条，重要 4、建议 1、阻断 0。下面先列处理结果，再附报告原文（路径里的 `wt/` 是审查用的 worktree）。

## 处理结果

| 编号 | 结论 | 处理 |
|---|---|---|
| C1 浮动窗口第一次挂载就打开时一直隐藏 | 成立。reka 的 `Teleport` 挂载后才渲染内容，应用初次挂载时就打开的面板晚一拍出现，原先只排一次 `nextTick` 的定位落空；Lab 画布里不出现（夹具在更新的 flush 里挂载） | `useFloatingWindow` 的定位改为看“打开时的面板元素”，渲染之后（`flush: "post"`）直接量。回归：`components.test.ts` 传送到 body、第一次就打开与关了再开都可见（修前读到 `hidden`） |
| C2 自定义取色面板开着时禁用色板仍能改值 | 成立 | `ColorSwatches` 把 `disabled` 传给面板（`ColorPicker` 本来就这样传），`.md` 补一句。回归：`ColorSwatches.test.ts` 面板开着时变成禁用（修前发出 `#aabbcc`） |
| C3 输入未结算时文件被外部移走，字数停在旧值并反复重算 | 成立 | 字数缓存在 `deleted`（保留正文）时也写入；加载中与加载失败不缓存。回归：`status-items.test.ts` 真实 Files 场地外部改名（修前 `3 字`，退回修复后失败） |
| C4 非模态窗口缺少外部交互与首尾 Tab 循环的联合测试 | 不改 | `Dialog.md` 对浮动窗口只承诺“不锁焦点，窗口外仍可点击与聚焦”，没有承诺窗口内首尾循环，reka 其余实现细节不属于组件合同；承诺的部分已由 `lab-nb-ui.e2e.ts` 覆盖 |
| C5 Lab 把主题焦点环一律读成 3.5px | 成立，真实 Chrome 复现：自定义属性的计算值不规范化，四套主题读到的都是无单位的 `0` 与 `color-mix(…, transparent)` 原文，解析全部落空、退回 3.5px（aurora 实际 4px 漏报，editorial 实际 3px 误报） | `lab-debug.ts` 按顶层切词：长度带 px 或是无单位 0；只有颜色本身全透明才排除。Spec `ui/component-lab.md` 追加验收 28，`lab-shot.e2e.ts` 新增三套主题的探针用例。第一版把 `rgb(0, 0, 0)` 末尾的蓝色 0 当成 alpha，纯黑的环被当成透明，验收 26 的对话框用例抓到，改为 alpha 只看斜杠后面或逗号写法的第四个参数。变异 3 处（不认无单位 0、见 `transparent` 字样就算透明、`rgb` 末位当 alpha）都被 `lab-shot.e2e.ts` 抓到 |

报告末尾的回写建议 2（作品信息文档与 UI 自检里的旧说明）已改；建议 1 交开发者定。

## 报告原文

### C1 首次挂载即打开的浮动窗口一直保持隐藏

- **严重程度**：重要；**类别**：正确性。
- **位置**：`wt/packages/nb-ui/src/composables/useFloatingWindow.ts:240–253`；`wt/packages/nb-ui/src/components/feedback/Dialog.vue:327–328`。
- **现象**：以 `modelValue=true, modal=false` 初次挂载 `Dialog`，面板最终仍是 `visibility: hidden; left: 24px; top: 24px`，无法看到或操作窗口。Lab 的 `Dialog/window` 与 `Dialog/window-resizable` 场景正是初始打开的用法。先以关闭状态挂载、再打开的对照组可见。
- **为什么是问题**：`useFloatingWindow` 的立即 watcher 只排一次 `nextTick`；Reka 2.10.3 实际入口的 `Teleport` 到 `onMounted` 才开启渲染。这一次回调执行时 `windowRef` 仍为 null，直接返回，后续面板挂载没有重新定位的触发点，`positioned` 永远为 false。窗口的可见性以它为条件。组件合同承诺打开时居中显示，不能只支持已经挂载过的打开流程。
- **如何核实**：已运行 `node ./node_modules/vitest/vitest.mjs run --config ../review-vitest.config.mjs --configLoader native`。仓库外 `review-smoke.test.ts` 挂载真实 Vue/nb-ui/Reka 组件，等待 `flushPromises()` 后读行内样式；“第一次就打开的浮动窗口最终不应仍然隐藏”失败，实际值为 `hidden`；“已挂载后再打开的浮动窗口最终可见”通过。运行代码依据为 `node_modules/reka-ui/dist/Teleport/Teleport.js:28–41`。未在浏览器中复现；可用 Lab 的上述两个初始打开场景核实真实页面。
- **建议改法**：由“窗口已打开且 `windowRef` 已可用”共同触发定位，面板首次挂载后完成居中并解除隐藏；补一个使用默认 Teleport、初始 `modelValue=true` 的可见性回归判据，现有浮动窗口测试只读尺寸与事件而未检测隐藏状态。

### C2 已打开的自定义取色面板绕过 ColorSwatches 的 disabled

- **严重程度**：重要；**类别**：正确性。
- **位置**：`wt/packages/nb-ui/src/components/form/ColorSwatches.vue:151–160`；调用处 `wt/packages/neuro-book/src/plugins/projects/web/components/ProjectInfoDialog.vue:239–249`。
- **现象**：打开“自定义”后将色板设为 `disabled=true`，颜色值输入框仍可编辑；输入 `#aabbcc` 并回车，仍发出 `update:modelValue('#aabbcc')`。外部将控件禁用时无法冻结已经打开的面板。
- **为什么是问题**：普通色块选择由 `choose()` 检查禁用状态，“自定义”入口也检查；面板却没有收到 `disabled`，而其更新直接无条件向外转发。`ColorSwatches.md` 承诺禁用时色块不可选，作品信息对话框也用 `busy` 禁用整个主题色控件，这条持续可写的路径破坏了同一控件的禁用合同。
- **如何核实**：已运行 `node ./node_modules/vitest/vitest.mjs run --config ../review-vitest.config.mjs --configLoader native`。仓库外 `review-smoke.test.ts` 经真实色块点击打开面板，再设 `disabled=true`，经 DOM 输入与回车修改颜色；断言未发更新失败，日志为 `{ inputDisabled: false, updates: [['#aabbcc']] }`。没有调用组件内部方法或替换 Reka。未在浏览器中复现。
- **建议改法**：向 `ColorPickerPanel` 传递禁用状态并阻止禁用后的更新；按既有交互决定是否在禁用时关上面板。补“先打开、后禁用”的行为测试，不能只覆盖禁用时打不开入口。

### C3 外部删除前尚未结算的字数永久停在旧值并反复重算

- **严重程度**：重要；**类别**：正确性与性能。
- **位置**：`wt/packages/neuro-book/src/plugins/editor/web/status-items.ts:69–72`、`:86–96`。
- **现象**：当前文档从 `第一章` 输入为 `第一章 rain falls`，在停手计时到期前被外部移走。文档进入 `deleted`，正文仍保留，但字数连续四轮 300ms 都是旧的 `3 字`，而非 `5 字`；每轮回调执行后仍有一个待执行计时器。
- **为什么是问题**：`countNow()` 对完整正文计数，却只在 `ready` 状态写入缓存。`deleted` 文档的到期回调增加 `settled` 后，条目再次求值发现缓存修订号仍旧，又排同一修订的计时，形成持续全文重算且不更新显示的循环。编辑器 Spec 输出 18 明确保留外部删除文档的正文；输出 27 要求显示活动文档当前正文的字数。删除不应使已经接受的输入无法结算。
- **如何核实**：已在 `wt/packages/neuro-book` 运行 `bun test ./../../../word-count-smoke.test.ts`。实验使用真实 Files 场地、`createEditorArea()`、状态条目与注入的 `ManualClock`，经文件系统 `rename` 使原地址不存在，等待真实 watcher 将文档标为 `deleted`，再推进四次 `WORD_COUNT_DELAY_MS`。断言失败：`Expected: "5 字" / Received: "3 字"`；日志四轮的 `fired` 为 1、2、3、4，`pending` 始终为 1。没有伪造文档状态；实验文件与输出保留在报告目录。
- **建议改法**：让保留正文的 `deleted` 文档也能缓存已结算的修订；对无正文的加载/失败状态另外处理。补“输入未结算时被外部删除，停手后显示保留正文字数且不继续重排”的回归判据。

### C4 非模态窗口缺少外部交互与双向 Tab 循环的联合回归判据

- **严重程度**：建议；**类别**：测试。
- **位置**：`wt/packages/nb-ui/src/components/feedback/Dialog.test.ts:1–5`；`wt/packages/nb-ui/src/components/components.test.ts:719–735`、`:799–882`；`wt/packages/neuro-book/e2e/lab-nb-ui.e2e.ts:100–123`。
- **现象**：Dialog 改用 Reka 后，组件测试覆盖模态焦点、非模态不关闭和拖动缩放，浏览器用例覆盖外部点击与聚焦，却没有断言非模态窗口内最后一个控件按 Tab 回到第一个、首个控件按 Shift+Tab 回到最后一个。现有首尾循环测试直接调用 `trapTabKey()`，新版 Dialog 已不使用该工具，不能替新焦点路径守门。
- **为什么是问题**：R​​eka 的 `FocusScope` 把 `loop` 与 `trapped` 分开：`modal=false` 关闭焦点锁定，但 `DialogContentImpl` 仍传入 `loop`。允许窗口外点击或聚焦，不证明首尾循环仍有效；测试应守住两种行为同时成立，避免迁移后只验证“非模态”这一半。这里报告的是明确的覆盖缺口，没有声称当前首尾循环已坏。
- **如何核实**：已阅读 Reka 2.10.3 的实际运行入口 `Dialog/DialogContentImpl.js:68–72`、`Dialog/DialogContentNonModal.js:68–70` 与 `FocusScope/FocusScope.js:139–155`；已运行 `node ./node_modules/vitest/vitest.mjs run --config ../review-extra-vitest.config.mjs --configLoader native`，仓库外真实组件实验中，外部按钮可点击并持有焦点、窗口保持打开，两个方向的首尾循环及 `defaultPrevented` 断言全部通过。该文件另外两个根路径实验失败，属于变更前已有问题，未计入本次缺陷。happy-dom 只证明事件处理路径；未在浏览器中复现，不能代替真实键盘 Tab 验收。
- **建议改法**：在现有非模态浏览器用例中放置明确的首尾可聚焦控件，依次验证外部点击与聚焦、窗口保持打开、回到窗口后两个方向的 Tab 循环；保留真实 Teleport 与 Reka，不调用旧 `trapTabKey()` 来代替用户操作。

## 验证记录与边界

- 审查版本为 detached HEAD `b28db3a1`，范围 `daf159b4..HEAD`。报告中的结论仅对应这份快照；报告目录中另有修复处理记录，不作为本次只读审查的修后验证。
- 已运行 `node ./node_modules/vitest/vitest.mjs run --config ../review-vitest.config.mjs --configLoader native`：8 个文件、29 个用例；27 通过、2 失败。7 个仓库内测试文件全部通过，两个失败来自仓库外实验，对应 C1、C2。
- 已在 `wt/packages/neuro-book` 运行 `bun test ./src/plugins/editor/status-items.test.ts ./src/plugins/projects/web/shelf-format.test.ts`：16 通过、0 失败，73 次断言。另运行 `bun test ./src/plugins/lab/web/focus-rules.test.ts`：3 通过、0 失败，9 次断言。
- 已在 `wt/packages/neuro-book` 运行 `bun test ./../../../word-count-smoke.test.ts`：1 个用例失败，复现 C3。另运行 `bun test ./../../../word-count-loading-smoke.test.ts`：1 通过、0 失败，6 次断言；扣住真实 Files 读取回复时，新旧算法都显示 `0 字`，放行后字数立即变为 `5 字`，没有推进字数时钟。慢读取候选不属于 t77 新引入，未列入问题。
- 已运行 `node ./node_modules/vitest/vitest.mjs run --config ../review-extra-vitest.config.mjs --configLoader native`：3 个用例，1 通过、2 失败。通过的是 C4 的非模态真实组件事件实验；失败的是 `/` 被视为空位置、`C:\` 提交成 `C:` 的根路径实验，对照旧 `ProjectInfoWindow` 确认相同处理已存在，未列为本次新缺陷。
- 两包已分别运行 `bun run typecheck`，均退出 0：nb-ui 执行 `nuxt prepare playground && vue-tsc --noEmit && vue-tsc --noEmit -p playground`；neuro-book 执行 `tsc --noEmit && vue-tsc --noEmit -p tsconfig.web.json && vue-tsc --noEmit -p tsconfig.browser-test.json`。
- 按任务约束，没有运行 e2e、开发服务、构建或依赖安装。C1、C2 与 C4 未在真实浏览器中复现；Lab 的实际裁切、稳定测量和截图行为只有静态依据，未作浏览器验收。
- 未纳入：关闭最后标签后的额外字数计算、非输入修订的 300ms 延迟缺少足够的新增合同影响；保存位置根路径、字段错误清除时机、自动色预览与对象 URL 延迟回收均在 base 已存在；Lab 的已知版面基线由开发者接受，清理归 t78。

### C5 Lab 把真实主题的焦点环误读成固定 3.5px

- **严重程度**：重要；**类别**：正确性与测试门禁。
- **位置**：`wt/packages/neuro-book/src/plugins/lab/web/lab-debug.ts:65–68`、`:77–93`；实际输入 `wt/packages/nb-ui/themes/aurora/vars.css:55–57`，Lab 装载处 `wt/packages/neuro-book/src/plugins/lab/web/lab-theme.ts:24`。
- **现象**：`focusRingExtent()` 读取 aurora 的真实主题 token（内圈 2px、外圈 4px）却返回默认 `3.5`。Lab 支持切换到该主题，距离裁切边 3.5–4px 的控件因此不会进入 `clippedFocus`，即使实色环仍会被裁。nbook/macOS 的 3.5px 与默认值碰巧相同，现有默认主题用例发现不了这条路径。
- **为什么是问题**：`shadowLayers()` 只提取带 `px` 的长度，还要求至少两个长度；主题实际写成 `0 0 0 4px`，三个无单位的零都被忽略，整层被跳过。即便把零都写为 `0px`，`transparent` 正则仍会把 `color-mix(in srgb, blue 55%, transparent)` 这类实际有颜色的半透明环当作全透明丢掉。此次把旧的 7px 回退改为 3.5px 后，aurora 的 4px 实色环出现漏报，违背 Lab Spec 的“按主题 `--focus-ring` 实色部分测量”合同；editorial 的 3px 环也会被放大到 3.5px 产生误报。
- **如何核实**：已运行 `node ./node_modules/vitest/vitest.mjs run --config ../lab-token-vitest.config.mjs --configLoader native`。实验从真实 `aurora/vars.css` 读取 token，设置它引用的两个颜色变量，经 `getComputedStyle()` 和产品的 `focusRingExtent()` 计算，得到 `{actual: 3.5, explicitPx: 4, mixedColor: 3.5}`：显式 `0px` 加纯黑对照正确，真实 token 与显式 `0px` 的半透明混色对照都错误。1 个用例失败，`Expected: 4 / Received: 3.5`。之前两次实验未进入判据，分别因 Vitest CSS raw 导入和 `import.meta.url` 的非 file URL，已改为读取真实文件；它们不是产品失败。未在浏览器中复现实际裁切；可在 `/lab?c=Button&theme=aurora` 放置距裁切边 3.75px 的按钮，对照焦点截图与 `measure().clippedFocus` 核实。
- **建议改法**：按 CSS 长度序列读取无单位零与带单位长度，保留 x/y/blur/spread 的位置；只在颜色实际全透明时排除，不按混色表达式里出现 `transparent` 关键字判断。用真实主题 token 验收不同实色扩散量，并覆盖混入透明色但 alpha 非零的环，避免全靠默认 3.5px 掩盖解析失败。

## 收口补充

- 书架与 Lab 的独立审查均已完成，没有提交新的独立 finding；主会话对 C1–C5 逐条负责。Lab 子审查提出的舞台截图与画布浮层范围候选，经 base 对照属于既有行为，未计入。
- C5 已补上纯计算运行证据；实际焦点环裁切与真实页面门禁仍未在浏览器中复现，不把 happy-dom 当作布局证据。
- 最后运行 `git status --short --branch --untracked-files=normal`：`HEAD (no branch)`，没有被跟踪文件的修改；仅列出预先接入的各包 `node_modules` 符号链接。产品代码、测试与规范均未改，实验和报告保留在 worktree 父目录。

## 反思回写建议

以下仅为建议，未修改真相源。

| 编号 | 类别 | 依据 | 建议修改 | 目标位置 |
| --- | --- | --- | --- | --- |
| 1 | 踩坑 | 慢读取字数、根路径归一化与截图落点候选均能观察到问题，但对照 base 后确认并非本次引入；只看重命名后的新文件容易误判。 | 新增：“按提交范围审查时，候选问题先对照 base 的实现与调用链，重命名文件追溯旧路径；仅有新行号或新文件名不足以证明回归。既有问题另记，不计入本次新增缺陷。” | `.agents/skills/reviewing/SKILL.md` 的“实现审查” |
| 2 | 规范缺陷 | `ProjectInfoDialog.md:21` 仍要求字段下显示错误，和当前 Spec、FormField 合同及实现相反；`ui-development-spec.md:432` 仍把约 7px 写成 Lab 判据，而测量已改为主题环的实色扩散量。 | 改写组件合同：“能事先防住的禁用提交；提交后字段错误标红并聚焦，原因写在页脚状态行，字段下仅保留读屏文案。”改写自检：“裁切机检按主题 `--focus-ring` 不偏移环的扩散量；偏移与模糊阴影另作视觉检查，不以固定像素值代替。” | `wt/packages/neuro-book/src/plugins/projects/web/components/ProjectInfoDialog.md` 的“交互”；`wt/packages/nb-ui/docs/ui-development-spec.md` 的“开发后自检与易错清单” |

## 各级数量

| 严重程度 | 数量 | 编号 |
| --- | ---: | --- |
| 阻断 | 0 | — |
| 重要 | 4 | C1、C2、C3、C5 |
| 建议 | 1 | C4 |
| 合计 | 5 | C1–C5 |

