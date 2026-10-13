# t82 实施计划：面板的拖动手势

## Context

- **为什么做**：开发者 2026-10-12 手动审查 t79 时提出三条，选择另开 Task：
  1. 面板上沿拖不到顶；希望拖到顶就是最大化。
  2. 点“最大化面板”后，不能从顶部往下拖来取消最大化。
  3. 面板拖到零以后再往外拖，拖的过程中面板是一块空面，松手才出现内容。
- **原因**（读代码确认）：
  1. 面板高度上限写死 600px（`shell/sizes.ts` 的 `SHELL_PANEL_MAX_HEIGHT`，Spec 输出 4 的 80..600），也没有“拖到顶即最大化”的规则。
  2. 最大化时面板两侧的边界宽度为 0（`shell/layout.ts` 的 `shellSashSize`：面板收起为标题头或最大化时返回 0），编辑器是固定 0 的叶，没有东西可拖。
  3. 拖到零的 Part 内容停放在 `inert` 的停放区（`WorkbenchShellLayout.vue` 的 `parkedParts()` 按投影里的 `dragCollapsed`），要等手势落账、投影更新后才搬回叶里；拖动中只有网格的预览几何在变。
- **依据**：[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳一输出 4、7、8、10，验收 3、4、6；[`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md) 的收起判定。
- **开发者已确认**（2026-10-13，三项都按推荐）：去掉面板高与宽的固定 600 上限，只受编辑器最小尺寸约束；凡是能最大化的位置（含左右）都适用；吸附阈值沿用拖到零的 24px。
- **工作方式**：一个 Task 一个 worktree：`.worktree/w00017-t82-panel-gestures`，分支 `feat/w00017-t82-panel-gestures`，从 `refactor/w00017-runtime-foundation` 切出。逐片提交、推送。测试不用 mock、spy、假计时器、固定等待。

## 关键设计

### 1. 最大化 = 编辑器拖到零（`shell/layout.ts`、`shell/sizes.ts`）

把“拖到顶即最大化”看成编辑器在面板所在的那一轴上拖到零，和侧栏、右栏、面板的拖到零用同一套收起判定（`nested-grid` 的阈值吸附），不另写一套手势。

- **上限**：面板高、面板宽不再有固定的 600 上限，只受“编辑器最小尺寸”约束（高 120、宽 272，输出 4）。`shellPanelAxisLimits` 的 `maximumSize` 改为不设上限；`SHELL_PANEL_MAX_HEIGHT`、`SHELL_PANEL_MAX_WIDTH` 删掉，`clampPanelHeight` 只夹下限。连带：偏好可能比窗口还大（在高窗口里拖到 700 再把窗口变矮），所以高度装不下时先把面板压到给编辑器留出最小高度 120，连面板最小高度 80 都放不下才退到 32px 标题头；现在是偏好放不下就直接退成标题头。分栏与紧凑呈现一样，Spec 输出 5 写明。
- **编辑器的收起意图**：最大化可用时（`panelMaximizable(position, alignment)` 为真、分栏呈现、面板没有收起为标题头），在编辑器与面板同在的那个分支里，给编辑器叶写收起意图：`collapsedSize: 0`、阈值沿用 `SHELL_DRAG_COLLAPSE_THRESHOLD`（24px）、`collapsed` 等于当前是否最大化。编辑器仍是吸收余量的叶，不改成 `fixed`。收起意图标 `toggleable: false`：面板在底部或右侧时编辑器在边界前侧，网格的 Enter 优先切换前侧，不标就会把“恢复拖到零的面板”（输出 8）变成最大化；这个选项在 S1 加进 nb-ui（网格与独立 `Splitter` 一致）。往上拖到编辑器的理想高度低于 `120 − 24` 时吸附成 0，就是最大化；从最大化往下拖，编辑器回到 120 以上时展开，就是还原，面板高度跟着指针。
- **边界**：最大化时面板与编辑器之间的边界保留 1px（`shellSashSize` 只在“收起为标题头”时返回 0）。最大化下编辑器内容照旧停放。
- **最大化不可用时**（水平位置但对齐不是居中，面板跨到侧栏下方）：编辑器不写收起意图，面板拖到编辑器的最小高度就停住。
- **落账**：`shellPatch` 看到 `change.collapsed.editor`：为 true 时补丁写 `panelMaximized: true`；为 false 时写 `panelMaximized: false`，并照常写面板这一轴的新尺寸。`ShellSizePatch` 加 `panelMaximized?: boolean`。

先确认 nb-ui 网格支持“余量叶”上的收起意图：收起判定按子节点的 `collapse` 意图与理想尺寸走（`packages/nb-ui/src/components/layout/sash-drag.ts`、`grid-gesture.ts` 只读边界与收起意图，不看 `sizing`），但余量叶在手势里的边界怎么取、收起后余量怎么重分，要用网格测试钉住。不支持时在 nb-ui 里补上，并在 `grid.md` 写明。

### 2. 最大化只在内存（`state/layout-store.ts`）

`commitSizes(patch)` 收到 `panelMaximized` 时改内存里的 `maximized`，不落盘；与“最大化/还原面板”命令走同一个内存位，所以换位置、对齐、隐藏、收起、进入紧凑时照旧清除（输出 7）。焦点规则沿用输出 10：拖成最大化时，焦点若在被停放的编辑器里，移到面板标题。

### 3. 拖动中就显示内容（`components/WorkbenchShellLayout.vue`）

`GridRenderer` 已经发出 `gesture-start`、`gesture-update`（带预览的 `changes[].collapsed` 与布局尺寸）、`gesture-end`、`gesture-cancel`。外壳监听它们，记下“预览里已经展开”的部件：投影里拖到零（或最大化下的编辑器），但当前预览里尺寸大于 0 的。`parkedParts()` 不再停放这些部件，预览变化后按下一轮 DOM 重新 `syncTargets()`；取消时清空，内容回到停放区。

- 不变量：内容只经 Teleport 搬动，不卸载（验收 6 的“创建 1 次、卸载 0 次”）；搬出停放区之前不抢焦点。
- 反方向（往零拖）不提前停放：松手落账后再停放，避免拖过阈值又拖回来时内容闪一下。

### 4. Lab 与组件文档

`WorkbenchShellLayoutFixture.vue` 的面板场景能直接拖出这三种手势（现有场景的内存状态就够），不新增场景；`WorkbenchShellLayout.md` 写明手势中的停放规则与“编辑器拖到零即最大化”。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/ui/workbench-shell.md` | 输出 5：高度装不下时先压缩面板、最小值也放不下才退到标题头；输出 4：面板高、宽不再有固定上限，只受编辑器最小尺寸约束；输出 7 的“瞬时最大化”：也可以把边界往编辑器那边拖过编辑器最小尺寸减 24px 得到，最大化时边界保留，往回拖过最小尺寸即还原；输出 8：从拖到零或最大化拉回时，内容在拖动中就出现；验收 3、4 补对应的 Given/When/Then |
| `packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShellLayout.md` | 手势中的停放规则 |
| `packages/nb-ui/src/components/layout/grid.md` | 只在需要补余量叶收起时改 |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S1 | 第 1 节前置 | nb-ui 网格对余量叶收起的测试；收起意图加 `toggleable`（`845359e5`、`8d61bcb9`） | `bun run --cwd packages/nb-ui test`、`typecheck` |
| S2 | 第 1、2 节 | 上限、编辑器收起意图、边界、补丁、内存最大化、高度装不下先压缩；Spec 输出 4、5、7（`ab218d9f`） | `bun run test:affected --typecheck` |
| S3 | 第 3 节 | 拖动中显示内容；Spec 输出 8；组件文档；e2e（`22052ed6`） | 同上；`lab:shot` 外壳场景 |
| S4 | — | e2e、验收映射、omp 审查与修正、收口截图 | 受影响 e2e 与全套 e2e |

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 4（无固定上限） | `shell/layout.test.ts`：1440×1400 的视口里面板能拖到 1000px；编辑器始终不小于 120 |
| 输出 7（拖成最大化、拖回还原） | `shell/layout.test.ts`：可最大化的位置与对齐给编辑器写收起意图、不可最大化时不写、最大化时边界 1px；`shellPatch` 的编辑器收起与展开两例；`state/layout-store.test.ts`：补丁里的最大化只在内存、换位置后清除 |
| 输出 8（拖动中显示内容） | `e2e/workbench-shell.e2e.ts` 的面板手势一例：拖到零后用真实指针往外拉，松手前内容已在面板落点、可见（happy-dom 量不出盒子尺寸、只按紧凑呈现，组件测试测不到手势，改由 e2e 覆盖） |
| 验收 3、4、6 | `e2e/workbench-shell.e2e.ts` 加三例：真实指针把面板上沿拖到顶松手 → 最大化，编辑器停放、刷新后不再最大化；从最大化往下拖 → 还原，高度跟着指针；面板拖到零后慢慢往外拖，松手前面板内容可见 |

## 验证

- 每片：`bun run test:affected --typecheck`（含 `src/architecture.test.ts`）。
- 端到端：先 `bun run build && bun run build:e2e`，再跑 `workbench-shell`、`workbench-views`、`settings` 与 Lab 场景门禁；收口前跑一次全套。
- 真实浏览器观察：开发会话里用鼠标拖三种手势，拖动中截帧（屏幕流）给开发者看。
- 未验证的边界：触屏手势（与现有拖到零一样只验证指针与键盘）。

## 不做与风险

- 不做：拖动中的弹性回弹或动画；面板之外的 Part 的最大化。
- 风险：编辑器有了收起意图后，编辑器的“余量”语义与收起判定之间可能有边角（装不下时的压缩、紧凑往返）；S1 先用网格测试钉住，S2 的布局测试覆盖装不下的情况。
