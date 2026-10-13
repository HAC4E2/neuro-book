# t83 实施计划：拖放、分栏、标签溢出与标题栏

## Context

- **为什么做**：开发者 2026-10-12 手动审查 t79 时认为移动视图与容器的落点指示和动画、标题栏宽度自适应、多级菜单都不如旧应用。调研（[差距清单](artifacts/gap-review/index.html)）查明：拖放判定与覆盖层两边几乎是同一套，新应用“没有落点”的主因是默认布局里空右栏与面板不显示；标题栏只有三档；多级菜单旧应用只用在收拢菜单。开发者 2026-10-13 定了范围并另加三项（Task README 的“开发者的决定”）。
- **静态稿**：[评审板](artifacts/review/index.html)：第一轮（预备区、空区域与高亮、分栏的开放式分割线与整行收起、标签溢出、标题栏让位表、拖放核对表）与第二轮（悬停线、分栏标题、往有收起分栏的容器里放视图、标签的宽度适配，以及开发者 2026-10-13 七条反馈里两条问题的答复）。待定项本计划按推荐写。
- **前置**：t81（分支 `t81/nb-ui-fixes`，nb-ui 字号写法被编译成颜色）先合进 w00017 主线：标签字号偏大就是这个缺陷，t83 的标签宽度适配按合入后的 11px 设计。
- **依据**：[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳二输出 16、17，外壳三输出 19–23，输出 28、38、39 与宽度三档；nb-ui [`Tabs.md`](../../../../../packages/nb-ui/src/components/controls/Tabs.md)、[`Splitter.md`](../../../../../packages/nb-ui/src/components/layout/Splitter.md)、[`DropFeedbackOverlay.md`](../../../../../packages/nb-ui/src/components/layout/DropFeedbackOverlay.md)、[nb-ui 拖放反馈规范](../../../../../packages/nb-ui/docs/ui-development-spec.md)。
- **工作方式**：一个 Task 一个 worktree：`.worktree/w00017-t83-dnd-titlebar`，分支 `feat/w00017-t83-dnd-titlebar`，叠在 t82 的分支 `feat/w00017-t82-panel-gestures` 上切出（两者都改 `WorkbenchShellLayout.vue` 与外壳 Spec，叠着做不用事后解冲突）；两条分支何时合回 `refactor/w00017-runtime-foundation` 由开发者安排。逐片提交、推送。测试不用 mock、spy、假计时器、固定等待；组件改动配同名 `.md` 与 Lab 场景，跑 `lab:shot`。

## 关键设计

### 1. 分栏：开放式分割线与整行收起（`components/WorkbenchShellLayout.vue`、`WorkbenchViewContainerHost.vue`、`WorkbenchViewSection.vue`，nb-ui `Splitter`）

- **修回归**：t79 在外壳根上设 `--nb-splitter-seam: var(--shell-seam, var(--divider))`，继承进了卡片里的容器分栏，nbook 下分栏边界透明。改为只作用在外壳网格自己的边界上（外壳网格的分隔条带外壳的标记，按标记设），容器分栏另取主题变量 `--shell-pane-divider`（nbook 是 `--divider`；macos 不声明，回落到贯穿的接缝）。
- **开放式分割线**：nb-ui `Splitter` 的接缝加一个变量 `--nb-splitter-seam-inset`（沿长轴两端各缩进多少，缺省 0）；nbook 的容器分栏两个方向都设 10px，同活动栏与侧栏之间那条短线。命中区不变。
- **紧凑的展开标记**（第三轮 R3-2）：箭头 12px、不画按钮框、与图标间距 2px，标题行左边距 8px；悬停底色左右各留 4px、上下各留 3px，圆角 6px，不贴满整行。面板里收成 32px 的竖条同理，箭头 12px，悬停底色四周留 3px。
- **整行收起**：标题行除动作区外整行是一个可点的区域：点击切换收起（按下到松开移动不超过 6px 才算点击，超过就是拖动，与现有拖动门槛一致）；收起的竖条与标题行整条可点展开。键盘：展开标记仍是带 `aria-expanded` 的按钮，Tab 到它按 Enter 切换；标题文字是拖动把手，空格拿起（外壳三输出 23）。

### 1a. 拖动边界的悬停线（nb-ui `Splitter.vue`、`sash-feedback.ts`，`themes/nbook/vars.css`）

- 悬停与拖动时的线走主题变量：`--nb-sash-line-color`（缺省 `--accent-main`）、`--nb-sash-line-size`（缺省 3px，与现在的几何一致）、`--nb-sash-line-inset`（沿长轴两端缩进，缺省 0）、`--nb-sash-line-radius`（缺省 0），登记进 token 表。几何仍由 `sashBandBox` 算，厚度与缩进从变量读。
- 自由端与相交端分开（第三轮 R3-1）：只有自由端（碰到容器边缘的一端）按 `--nb-sash-line-inset` 缩进，碰到另一条边界的一端照旧连着，相交处成 T 形或十字形。线的两端是不是自由端由渲染器按网格结构判断（边界的两端是否落在别的边界上）。
- 发光：`--nb-sash-line-glow`（缺省 none），nbook 设成 `--focus-ring`，线芯 1px 强调色 85%，与输入框聚焦同源。
- nbook 卡片主题：线芯 1px、发光、自由端缩进 16px（缝加卡片圆角）；macos 平铺不声明，保持现在的样子。验收时（2026-10-13）开发者认为发光不如实线，nbook 改用缺省的 3px 实线、不发光，缩进与交汇处相连不变；发光 token 留在 nb-ui，缺省 none。

### 2. 空区域与高亮（`components/WorkbenchToolPartHost.vue`，nb-ui `styles.css`、`themes/nbook/vars.css`）

- 空 Part 的占位：内缩 8px 的整块虚线框（1px dashed，`--text-main` 24% 混色），圆角 10px，文字居中、`--text-muted`。
- 落点高亮改走变量：nb-ui 加 `--drop-area-fill`（缺省强调色 12%）、`--drop-area-border`（缺省强调色 70%），登记进 token 表；nbook 设 20% 与实色。

### 3. 收起的分栏当落点、放进收起的面板（`views/drop.ts`、`views/drop-dom.ts`、`state/layout-store.ts`）

- 命中收起的视图（竖条或 32px 标题行）时不按半区判定，按指针在条的前半或后半给“插在它前面或后面”的插入位，预览画插入线（与标签带同一种），提示写在线的右端，“放在 X 前／后”。全部收起时，标题之间与最后一个之后都是插入位，剩余区等于“插在最后”（现在不管指在哪里都追加到最后）。放下后拖入的视图在插入位、展开，其余收起的保持收起；份额取相邻展开栏的一半，相邻都收起时取剩余区（外壳三输出 20、21 补这条）。
- 放进收起成 32px 标题头的面板时，同次清掉面板的收起（与“经移动到放进不显示的区域时区域随之显示”同一原则，输出 39）。

### 4. 拖动时浮出预备区（`views/drag-session.ts`、`views/drop.ts`、`components/WorkbenchDragFeedback.vue`）

- 拖动开始时，凡是此刻没显示的侧栏、右栏、面板（缺省不显示、被隐藏、拖到零、紧凑呈现下不算），按它们显示后会在的位置与记住的尺寸算出预备区矩形，叠在当前布局上，不改布局。矩形由外壳投影求出：拿当前偏好把这个 Part 当作显示，跑一遍 `projectShell`，取它的叶矩形；预备区之间、与真实落点之间不重叠时才显示（重叠的按真实落点优先）。
- 预备区是整区落点：接收单视图与整容器，语义与“空 Part 内容区”相同（外壳三输出 20），提交时同次把这个 Part 显示出来（隐藏位清掉、拖到零清掉、空右栏记为主动显示过），视图或容器放进去并选中。
- 外观：虚线框、`--panel-surface` 的半透明面、中央一枚图标加名称的提示；悬停时换成落点高亮与“放到 X”。拖动结束或取消时淡出。

### 5. 放下后的过渡（nb-ui `DropFeedbackOverlay.vue`，`components/WorkbenchDragFeedback.vue`）

- `DropFeedbackOverlay` 加一个“收尾”状态：宿主在提交成功后把预览换成视图最终所在的矩形并标记收尾，覆盖层沿用现有的位置与尺寸过渡移动到那里，再淡出（`--motion-base` 后开始淡出，淡出用 `--motion-fast`），之后不渲染。新显示的 Part 从预备区矩形过渡到最终叶矩形。系统开了减少动效时直接消失。
- 最终矩形在提交后的下一帧读：外壳的落点重排完成、`data-view-section` 的盒子到位后量。

### 6. 标签溢出（nb-ui `Tabs.vue`，`components/WorkbenchShell.vue`、`WorkbenchToolPartHost.vue`、`WorkbenchActivityBar.vue`）

- nb-ui `Tabs` 加 `overflow?: "scroll" | "adapt"`（缺省 `scroll`，现有用法不变）与 `maxItemWidth?: number`。`adapt` 时逐级让位：完整标题 → 每个标签截断到 `maxItemWidth`（96px，保证收起前还能读出图标加四五个字）→ 选中的保留标题、其余只显示图标（悬停显示全名）→ 放不下的收进末尾的“更多 N”（nb-ui `Dropdown`，列图标与全名，选中即切换）。选中的始终带标题。宽度变化时用 `ResizeObserver` 重算，展开时多留 16px 回差。
- 工作台的面板与右栏标签带用 `overflow="adapt"`、`maxItemWidth=96`。拖动中：插入线只在可见标签之间与末尾（收进“更多”的标签不在标签带里）。
- 活动栏：条目放不下时把选中项以外的末尾条目收进底部的“更多”（同一套规则，纵向测量）。

### 7. 标题栏逐级让位与收拢菜单（`components/WorkbenchTitleBar.vue`、`titlebar/menu-model.ts`）

- 用测量代替三档：组件量出各项的自然宽度，按顺序收：横排标志换图形 → 菜单栏收成 ≡ → 收快捷键提示 → 布局按钮收进 ≡ 的“视图”组 → 项目切换只留图标；展开时多留 40px 回差。每一档按搜索留 480px 判定要的宽度（按第一轮让位表的切换点反推），全部收完之后搜索再往下收；搜索取中间剩余，120..560px。条目区保持现有的“更多”。
- 收拢菜单：菜单模型的每组成为一个父项（`children`），≡ 打开四行，悬停或方向键展开子菜单。布局按钮收进来时出现在“视图”组里（已有对应的勾选项）。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/ui/workbench-shell.md` | 外壳二输出 16：标题整行与竖条整条点击切换收起，键盘 Enter；输出 38：容器分栏的开放式分割线；外壳三输出 20：预备区（没显示的 Part 拖动时浮出、提交时显示）、收起的视图按前后插入；输出 21：命中收起视图时的份额；输出 22：空 Part 的虚线框、收尾过渡；输出 25：标签带溢出进“更多”；输出 28 与宽度三档改为测量让位；输出 39：预备区提交即显示；对应验收补场景 |
| nb-ui `Tabs.md`、`Splitter.md`、`DropFeedbackOverlay.md`、`ui-development-spec.md` 的拖放反馈 | 新增选项与变量 |
| 工作台组件同名 `.md` | `WorkbenchViewSection`、`WorkbenchViewContainerHost`、`WorkbenchToolPartHost`、`WorkbenchDragFeedback`、`WorkbenchShell`、`WorkbenchActivityBar`、`WorkbenchTitleBar` |
| `theme/system.md` | `--shell-pane-divider`、`--drop-area-*` |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S1 | 第 1 节 | 修分栏接缝回归、开放式分割线、整行收起 | `test:affected --typecheck`；`lab:shot` 容器场景 |
| S2 | 第 1a、2 节 | 悬停线变量、空 Part 虚线框、落点高亮变量 | 同上；nb-ui `build:css` |
| S3 | 第 3 节 | 收起视图的前后插入、放进收起面板时展开 | 同上 |
| S4 | 第 4 节 | 预备区 | 同上 |
| S5 | 第 5 节 | 收尾过渡 | 同上 |
| S6 | 第 6 节 | `Tabs` 溢出菜单、标签带与活动栏 | 同上；nb-ui 测试 |
| S7 | 第 7 节 | 标题栏测量让位、收拢子菜单 | 同上 |
| S8 | — | e2e、omp 审查与修正、收口截图 | 受影响 e2e 与全套 e2e |

## 验收映射

| Spec | 覆盖 |
|---|---|
| 外壳二输出 16（整行收起） | `WorkbenchViewSection` 的组件测试：点标题行切换、按住移动不切换、Enter 切换、空格拿起；`workbench-views.e2e.ts` 用样例视图点整行收起与展开竖条 |
| 输出 38（分割线） | `workbench-views.e2e.ts` 的分隔方式一例：nbook 容器分栏的接缝是 `--divider` 且两端缩进，macos 贯穿 |
| 外壳三输出 20、21（收起视图前后插入、预备区） | `views/drop.test.ts`、`views/dnd-model.test.ts` 的纯判定；`workbench-views.e2e.ts`：默认布局拖资源管理器到面板预备区，面板显示且视图在里面；隐藏右栏、侧栏拖到零两种同样；拖到收起竖条前后 |
| 输出 22（空 Part、收尾过渡） | `WorkbenchDragFeedback` 组件测试：提交后覆盖层到达最终矩形再消失、减少动效时直接消失；e2e 截帧 |
| 输出 25（标签溢出） | nb-ui `Tabs` 测试：截断、选中项总在、更多菜单切换、宽度变化重算；工作台 e2e 面板四个容器窄宽度 |
| 输出 28 与宽度档（测量让位） | `WorkbenchTitleBar.dom.test.ts` 的让位顺序与回差；`lab-item-strip.e2e.ts` 的七个宽度加中英文、长项目名 |
| 输出 39（放进收起面板、预备区提交） | `state/layout-store.test.ts` 的显示位同次写入 |

## 验证

- 每片：`bun run test:affected --typecheck`；改 nb-ui 样式后 `bun run --cwd packages/nb-ui build:css` 并提交 `dist/nb-ui.css`。
- 端到端：`bun run build && bun run build:e2e` 后跑 `workbench-views`、`workbench-shell`、`workbench-titlebar`、`lab-item-strip`、`settings` 与 Lab 场景门禁；收口跑全套。
- 真实浏览器观察：开发会话与带样例视图的探针服务里重做这次的核对表，截帧对照静态稿给开发者看。
- 未验证的边界：触屏拖动；键盘拖放进预备区（预备区进 Tab 顺序，按 Sidebar、AuxiliaryBar、Panel 的顺序排在可见落点之后，靠单测与 e2e 各一例，不做读屏实测）。

## 不做与风险

- 不做：M2（视图菜单里的单选子菜单）；拖动中改布局的实时让位动画；编辑器标签的拖放；往“更多”里拖放（不在已定的稿里，另开 Task）。
- 风险：预备区与真实落点的重叠判定（侧栏拖到零时它的预备区会盖住编辑区左侧）：先按“真实落点优先、预备区不盖住正在悬停的真实落点”做，e2e 覆盖侧栏拖到零。
- 风险：整行可点与整行可拖共存时误触：依赖 6px 门槛；e2e 用真实指针各一例。
