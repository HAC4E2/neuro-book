# t86 实现审查

2026-10-14，一个 opus 子代理按 [plan.md](../plan.md) 与禁止清单只读审查分支 `feat/w00017-t86-explorer-polish`（S0–S6）。下面先是处理结果，再是审查原文。

## 处理

| 条目 | 结论 | 处理 |
|---|---|---|
| R1 打开到指定组时结算错了组 | 改 | 只结算活动标签要换的那一组；新增编辑器区测试（活动组有未裁决输入时仍能打开到别的组、侧边的组有未裁决输入时被拦、组已关闭） |
| R2 叶子节点不能作为新建与粘贴目标 | 改 Spec | 叶子不能展开，按选中文件算，目标是它所在的文件夹；往里放东西用拖动。files-explorer “当前根与目标”写明 |
| R3 空白落点范围过大 | 改 | 只有最后一行之下是空白；行两侧内边距与滚动条那一条按同一高度的行算 |
| R4 测试缺口 | 改 | e2e 新增验收 21、23（排序、后缀、叶子、图标、改设置即时生效）与 24、26（在侧边打开、复制相对路径进系统剪贴板、拖到右边的组）；编辑器区 `group` 测试见 R1 |
| R5 停留展开用裸计时器、DOM 测试没有拖动用例 | 不改 | 组件里的计时器已声明 `env:timer`；拖动依赖真实布局与 `elementFromPoint`，jsdom 测不出，由 e2e 覆盖（停留展开、边缘滚动、拖影都有） |
| R6 `rightNeighbor` 让 `restore` 的注释悬空 | 改 | 挪到 `restore` 的注释之前 |
| R7 `realPath` 根外的失败码 | 改 Spec | files.md 写成 `outside-root` |
| R8 拖到编辑组仍等令牌 | 改 | 放下即打开，不等令牌；Spec 去掉“不受结果未知限制”（起拖条件照常） |
| R9 测试注释与断言不符、`copy-failed` 没测到 | 改 | 补没有剪贴板与剪贴板拒绝写入两例 |
| R10 边缘滚动中松手可能静默不写（推测） | 改 | 滚动中松手先停滚、等一帧按最后的滚动位置交一次落点，再按同一落点放下 |
| R11 拖着目录停在自己身上也会展开 | 改 | 只在落点是“移入这个目录”时计时 |
| R12 macos 的菜单阴影没动、取舍没记录 | 记录 | nbook 的菜单阴影是 t79 第五轮特意收小的，这次加一层远投影；macos 的菜单本来就用较深的浮层阴影，不动。记入 Task README |
| R13 缺失条目也有“复制路径” | 改 | 缺失条目不给这两项，复制时跳过；失败文案改为“没能复制路径” |
| R14 重试期间仍显示读取失败 | 改 | 失败后重新列出期间显示转圈 |

## 审查原文

# t86 实现审查（opus 子代理，只读）

### R1 应改：`nbook.editor.open` 带 `group` 时结算错了组：“side” 落到已有的右侧组时不结算那一组，指定别的组时又多结算了活动组
- 位置：packages/neuro-book/src/plugins/editor/web/area.ts:537-541
- 现象：(a) 左右两组，右组活动标签有未裁决输入；在左组执行“在侧边打开”（或 Ctrl+Enter）→ `sideGroup()` 返回已有的右组，`groups.open` 直接把右组的活动标签换掉，没有经过 `leave(右组)`，未裁决输入的提示被跳过；同样的情形用组 id（拖到编辑组）会被 539 行拦下，两条路径行为不一致。(b) 活动组有未裁决输入时，向别的组打开（拖到右边的组、在侧边打开）一律被 537 行以“当前视图有未裁决的输入”拒绝，但活动组的活动标签并不变。
- 依据：同文件 `activate`（567 行）与 `open` 里已有标签的分支（555 行）只结算“活动标签要变的那一组”；`leave` 的注释是“换文档前结算活动视图的输入”。输出 35 没有要求向别的组打开时结算活动组。
- 建议：先算出目标组（`"side"` 时先 `sideGroup()`，或改成先只查右邻、不新建），只对目标组调用 `leave`；目标组就是活动组时行为不变。补 area 层测试：side 到已有组且该组有未裁决输入、活动组有未裁决输入时向别组打开。

### R2 应改：叶子节点不能再作为新建与粘贴的目标，“新建文件”会建成它的兄弟
- 位置：packages/neuro-book/src/plugins/explorer/web/controller.ts:378（`createTarget`），tree/rows.ts:158（叶子 `expandable: false`），controller.ts:413（`pasteTarget` 复用 `createTarget`）
- 现象：内容文件夹里选中只有正文的节点 `沈屿`（leaf）→ 右键“新建文件” → 目标是 `沈屿` 的父目录、插在 `沈屿` 之前，而不是 `沈屿` 里面；粘贴同理。之前（非叶子）这两种操作都落在节点里。要往叶子节点里加第一个附件或子节点，只剩拖进去一条路；就算目标算成节点自身，`rows.ts` 里叶子永远 `expanded=false`，`directory()` 不会被调用，内联输入行也画不出来。
- 依据：Spec files-explorer.md“行的样子”的“叶子节点”只说“没有展开控件、不能展开，点它只选择或打开正文”，没有说新建与粘贴改投父目录；“当前根与目标”写的是“以选中的目录……为目标”，叶子节点仍是目录。这是计划与决定都没提到的行为变化。
- 建议：交开发者定：要么 `createTarget` 按 `row.type === "directory"` 判断目录（叶子也算），并让新建时叶子临时可展开（例如投影里 `creating.parent` 等于叶子时按可展开处理）；要么在 Spec 里写明“叶子节点上的新建与粘贴落在父目录”。补对应测试。

### R3 应改：“空白”落点不只是最后一行之下：行两侧的内边距与滚动条区域都算空白，放下就移到项目根
- 位置：packages/neuro-book/src/plugins/explorer/web/tree-drag.ts:94；行的左右内边距见 ExplorerTree.vue:442-445（`left/right: var(--view-inset-inline, 6px)`），滚动条 `scrollbar-gutter: stable`（ExplorerTree.vue:499）
- 现象：拖动 `正文/第一卷/第01章.md`，指针沿着树的右边缘（或左边 6px 内）经过 `设定/世界观.md` 那一行时，`elementFromPoint` 命中的是行容器或树本身而不是 `[data-explorer-row]`，`pointAt` 返回 `blank` → 动作变成“移入 <项目名>”，此时松手文件被移到项目根。窄侧栏里沿右边拖是常见手势。
- 依据：Spec files-explorer.md“拖动”的“落点”：“树里最后一行之下的空白移入项目根”；drop.ts 文件头与 tree-drag.ts 文件头写成了“树里行以外的空白”，与 Spec 不符。
- 建议：只在指针的 y 落在最后一行底边之下时算 `blank`（用行容器的高度或最后一个渲染行的矩形判断）；行的纵向范围内但不在行元素上时，按 y 找到那一行（行是等高的，可按 `(y - 容器顶) / 行高` 换算）当作命中该行。同步改 drop.ts 与 tree-drag.ts 的文件头说法。

### R4 应改：验收 21、23、24、26 与计划“验收映射”里列出的测试缺了几条，`area.open` 的 `group` 参数没有任何测试
- 位置：packages/neuro-book/e2e/files-explorer.e2e.ts（只新增了一个拖动用例）；packages/neuro-book/src/plugins/editor/area.test.ts（未改）
- 现象：对照计划“验收映射”与 Spec 验收 21–26：
  - 24：计划写“`files-explorer.e2e.ts`（剪贴板权限在 Playwright 里授予）”，e2e 里没有右键“在侧边打开”（先向右拆分）与“复制相对路径”读剪贴板的用例；`browse.test.ts` 只断言发出的命令参数。
  - 26：计划写“新增一例（两个编辑组）”，现有用例用 `[data-editor-group]` 的 `.first()`，只有一个组，没覆盖“拖到右边的组、右边成为活动组”，也没有“拖目录过去没有落点”的界面断言。
  - 23：设置改为 `none` 后参考线立即消失、hover 档鼠标移进树才显示、隐藏 `.md` 时 F2 改名框是完整名字，都没有测试（DOM 测试只看 `data-guides` 属性与 label 文本，计划写“e2e 改设置后的显示”）。
  - 21：真实页面里的中文数字顺序、`.content` 副标题、叶子无箭头、切暗色换色没有 e2e（排序有 files.test，暗色只靠截图）。
  - `area.open` 的 `group`（组 id、`"side"`、组已关闭为 unavailable、目标组未裁决）在 area 层没有测试；只有 groups.test 测了 `sideGroup()` 本身。R1 的问题正是这里没测出来。
- 依据：docs/testing/README.md“测试写法”：先列验收场景再实现、核心逻辑补测试；计划“验收映射”表。
- 建议：按计划补上 e2e（两个编辑组拖放、右键在侧边打开与复制相对路径、改设置后的参考线与隐藏 `.md`）与 area.test 的 `group` 用例；做不了的在 Spec 证据里写明哪条验收只到组件级。

### R5 建议：停留展开用裸 `setTimeout`，没有按计划用注入的时钟，组件级也没有拖动相关的测试
- 位置：packages/neuro-book/src/plugins/explorer/web/components/ExplorerTree.vue:237-259；ExplorerTree.dom.test.ts（全文没有 drag 相关用例）
- 现象：600ms 停留展开、拖影与源行淡化、边缘滚动只在一个 e2e 用例里用真实时间验证（Playwright 的自动重试，没有固定等待，本身不违规）；计划第 6 节写“计时用注入的时钟”，验收映射写 `ExplorerTree.dom.test.ts` 覆盖这几项，均未落实。
- 依据：计划第 6 节“停留展开”与“验收映射”；docs/testing/README.md“等可观察的状态或注入时钟”。
- 建议：给 ExplorerTree 一个可选的时钟 prop（缺省宿主时钟），DOM 测试里推进时钟验证“停 600ms 展开、落点换了重新计时、放下或取消后不再展开”；或在计划与 Spec 证据里改为“只在 e2e 覆盖”。

### R6 建议：`rightNeighbor` 插在 `restore` 的文档注释与函数之间，`restore` 的注释成了悬空注释
- 位置：packages/neuro-book/src/plugins/editor/web/groups/groups.ts:301-327
- 现象：301 行 `/** 从记录恢复：…… */` 之后紧跟 `rightNeighbor` 自己的注释与函数，327 行才是 `function restore`；编辑器悬停 `restore` 看不到说明，读者会把 301 行当成 `rightNeighbor` 的说明。
- 依据：AGENTS.md“注释”：注释是给人读的；从 diff 可见是插入位置错了。
- 建议：把 `rightNeighbor` 连同注释移到 301 行之前（或 `restore` 之后）。

### R7 建议：Spec 里 `realPath` 的失败码写错：根外是 `outside-root`，不是 `protected-path`
- 位置：docs/specs/workspace/files.md 方法表 `realPath` 一行；实现 packages/neuro-book/src/plugins/files/backend/files-service.ts:140-147 → `root.resolveEntry`（rooted.ts:157 经链接指向根外返回 `outside-root`）
- 现象：`realPath("project://out/secret.md")`（`out` 是指向根外的链接）返回 `outside-root`；Spec 写“控制目录与根外为 `protected-path`”。
- 依据：rooted.ts:157；entry-ops.test.ts:108 已断言 `outside-root`。
- 建议：Spec 改为“控制目录为 `protected-path`、经链接到根外为 `outside-root`、不存在为 `not-found`”；顺带在 files.test 的 realPath 用例里加一条根外链接。

### R8 建议：拖到编辑组仍要等拿起时的身份令牌、并受批量在途限制，与 Spec“不用令牌”的说法不符
- 位置：packages/neuro-book/src/plugins/explorer/web/controller.ts:952-967（`dropDrag`），927-945（`startDrag` 用 `freezeItems("move")`）
- 现象：(a) 放下在编辑组上时，963 行仍 `await items` 并要求 `frozen !== null`、`idle.value`；拿起时 identify 失败（文件刚被外部换掉、读不出）会直接取消拖动并给出“移动失败”的提示，用户想做的其实是打开。(b) 放下后等令牌期间有批量开始，打开被静默丢弃。
- 依据：Spec files-explorer.md“拖动”的“拖到编辑区”：“这不是文件操作，放下时不用拿起时冻结的身份令牌；起拖的条件照常”。
- 建议：`action.kind === "open"` 时在 `dropDrag` 开头直接 `openDropped` 并返回，不等 `items`、不看 `idle`；或者把 Spec 改成与实现一致（并说明 identify 失败时提示写的是“移动”）。

### R9 建议：browse.test 的注释说测“没有剪贴板时复制路径不可用”，断言的却是“没有选择”；`copy-failed` 两条路径都没测
- 位置：packages/neuro-book/src/plugins/explorer/browse.test.ts:418-420
- 现象：`explorer(at)` 新建的控制器没有选择，`copyPaths` 在检查剪贴板之前就以 `no-selection` 返回；`options.clipboard === undefined` → `copy-failed`、`writeText` reject → `copy-failed` 并 `report` 都没有被执行到。
- 依据：注释与断言不符；docs/testing/README.md“测行为”。
- 建议：先在无剪贴板的控制器上选中一行再断言 `copy-failed`；再给一个 `writeText` reject 的剪贴板，断言 `copy-failed` 且 `report` 收到错误。

### R10 建议（推演）：边缘滚动每帧先交落点再滚，显示的落点总比指针下的行晚一步；滚动中松手常常不写
- 位置：packages/neuro-book/src/plugins/explorer/web/tree-drag.ts:116-134（`autoScroll`），onPointerUp 240-242；ExplorerTree.vue:346-347（整段矩形用交出那一刻的 `scrollTop`）
- 现象：靠下边缘时每帧 `hover(pointAt)` 用的是滚动前的行，随后 `scrollTop += step`（最多 16px，行高约 26px）。松手时 `pointAt` 按滚动后的行判定，指针下换了一行而那两行的动作不同（跨文件夹边界、或目录行的“移入”中段）时 `sameDrop` 不成立，放下静默不写；浅底的整段矩形也按滚动前的 `scrollTop` 换算，滚动中会错开最多一步。最后一行恰在 24px 边缘带里，想放到它上面时尤其明显。
- 依据：tree-drag.ts 文件头说“每一帧先按上一帧滚动后重新渲染出的行判一次落点，再滚这一帧”，这正是显示与松手之间差一步的来源；Spec“只提交与最后显示相同的动作”。
- 建议：把顺序改为“先滚、等虚拟列表补行（下一帧开头）再交落点”，即在帧开头先按当前 DOM 交落点、之后不再滚就停；或滚动中松手时用上一次显示的落点（`over`）而不是重新 `pointAt`。至少在 Spec 或组件文档里写明“自动滚动中松手可能不写”。

### R11 建议：停留展开不看落点动作，拖着一个收起的目录停在它自己身上也会把它展开
- 位置：packages/neuro-book/src/plugins/explorer/web/components/ExplorerTree.vue:246-259
- 现象：拖动收起的 `正文/第二卷`，指针在它自己行的中段停 600ms → 发出 `drag-expand`，源目录被展开（此时动作是 none，没有落点）。同理，指向源已在其中的父目录也会展开。
- 依据：Spec“停留展开”的本意是为了能落到里面；落在自己或后代上没有落点（drop.ts 文件头）。
- 建议：只在 `props.drag?.action.kind === "move"` 且目标是这一行时计时，或排除 `drag.sources` 里的行。

### R12 建议：菜单阴影只改了 nbook 主题的 `--elevation-menu`，macos 主题不变；计划里的 ui-development-spec 浮层一节没有同步
- 位置：packages/nb-ui/themes/nbook/vars.css:289-296；packages/nb-ui/themes/macos/vars.css（未改，菜单回落到 tokens.css 的 `--elevation-menu: var(--elevation-popover)`）
- 现象：macos 主题下右键菜单阴影与改动前一样；计划第 5 节写“`--elevation-popover` 在 nbook 与 macos 两个主题里加深一档”，S0 改动表列了 `ui-development-spec.md` 浮层一节，二者都没做。改成只动 `--elevation-menu` 本身比计划更收敛，但没有记录这个取舍。
- 依据：计划第 5 节与“Spec 与文档改动（S0）”表；决定第一轮第 9 条“右键菜单……阴影：改”。
- 建议：在 Task 记录里写明只改 nbook 菜单投影的理由（或给 macos 也加一档），并同步 ui-development-spec 的浮层说明。

### R13 建议：缺失条目也有“复制路径”，执行必失败，提示却说“没能写进剪贴板”，并记一条错误诊断
- 位置：packages/neuro-book/src/plugins/explorer/web/menu.ts:54-55；controller.ts:265-290（`copyPaths`）
- 现象：右键内容文件夹里的缺失条目（`type: "missing"`）→“复制路径” → `realPath` 返回 `not-found` → `report(new Error(...))` 并返回 `copy-failed`，界面提示“没能把路径写进剪贴板”。多选里夹一个缺失条目时整次复制失败。这是可预见的用户输入，不是程序错误。
- 依据：从代码推演；Spec 只说复制“选中项在服务端机器上的绝对路径”。
- 建议：缺失条目的“复制路径”禁用（相对路径仍可用），或在 `copyPaths` 里跳过缺失条目；`not-found` 时给出具体原因而不是剪贴板失败，不当作诊断错误上报。

### R14 建议：重试期间行上仍显示“读取失败”，不显示转圈
- 位置：packages/neuro-book/src/plugins/explorer/web/tree/rows.ts:124-133（`problemOf` 先看 `slot.error`，不看 `slot.loading`）
- 现象：点错误标记或执行 `retry-list` 后，请求在途时 `slot.error` 还在、`listing` 仍为 null，行保持危险色与错误按钮，直到结果回来；慢盘或网络盘上看起来像点了没反应，用户会连点。
- 依据：Spec files-explorer.md“状态挂在行上”：“正在列出：展开箭头换成转圈”；`DirectorySlot` 已有 `loading` 字段。（改动前状态行也是同样的先后，不是本次引入的回归。）
- 建议：`problemOf` 里 `slot.loading && slot.listing === null` 时先返回 `{kind: "loading"}`；tree.test 的“目录的状态挂在自己的行上”补一条“失败后重试中为 loading”。
