# t84 实施计划：菜单贡献点

## Context

- **为什么做**：t83 验收反馈第 7 条。新应用的标题栏菜单写死在工作台里、按字符串写着别的插件的命令 id；视图标题只有图标按钮，没有“更多”；资源管理器右键与编辑区没有让别的插件加东西的位置。调研与决定见 [design.md](design.md)。
- **开发者已确认（2026-10-13）**：第一版做四处菜单位置：标题栏菜单、视图标题（含“更多”）、资源管理器右键、编辑区标题（含按后缀的局部条件）。编辑器标签右键与正文右键等第一个使用者；Markdown 预览本身打磨阶段之后再做。
- **依据**：平台设计稿（accepted）“菜单位置由拥有者定义，并规定菜单项收到的参数与局部上下文；`when` 由 workbench 求值”；贡献点由拥有者插件定义（t33）。
- **工作方式**：worktree `.worktree/w00017-t84-menu-contributions`，分支 `feat/w00017-t84-menu-contributions`，从 `refactor/w00017-runtime-foundation` 切出；主 Agent 编码，逐片提交并推送；记录只写主工作区。测试用真实内核、真实命令服务与公开状态，不用 mock、spy、假计时器、固定等待。

## 关键设计

### 1. 菜单项的共同合同（`packages/neuro-book/src/plugins/commands/shared/menus.ts`）

菜单项只是“在这里放一条命令”，所以合同放在命令插件的共享模块里，四个位置的拥有者复用：

```ts
interface MenuItemDeclaration {
    readonly command: string;
    readonly section: string;          // 同节连在一起，节之间画分隔线；节按名字的码元顺序排，例如 "1_save"
    readonly order?: number;           // 节内从小到大，同值按贡献 id
    readonly label?: LocalizedText;    // 省略时用命令标题
    readonly toggled?: string;         // 布尔公开键：画成勾选项
    readonly when?: WhenPredicate;     // 不满足时不显示（与条目贡献点同一规则：键已就绪且为真）
}
```

- 校验 `menuItemProblem(descriptor, schema)`：id 规则与条目贡献点相同（内置插件 `nbook.` 开头，其它插件以自己的插件 id 开头），声明按位置的 TypeBox 形状检查（各位置在共同形状上加字段，见下）。
- 纯函数 `arrangeMenu(items, facts)`：去掉命令不在目录里的、`when` 不满足的、局部条件不满足的；按节、顺序、id 排；可用与否与原因取命令自己的 `when`，快捷键取命令键位，勾选读公开键。输出节的数组，空节不出现，分隔线因此不会落在两端或连着。现有 `titlebar/menu-model.ts` 的 `buildMenus` 逻辑挪进来，标题栏改用它。
- **局部条件 `extensions`**：只在有“当前文件”的位置可用（资源管理器右键、编辑区标题）。值是后缀数组（`[".md"]`），按地址的文件名不分大小写地以后缀结尾判定；多选时全部匹配才显示，文件夹不匹配任何后缀。
- **参数**：菜单项默认以 `{}` 执行命令。有“当前对象”的位置由拥有者规定一种参数，菜单项声明 `args: "<名字>"` 才收到（同视图标题动作现有的 `args: "instance"`）：资源管理器右键 `args: "selection"` 收到 `{addresses}`，编辑区标题 `args: "resource"` 收到 `{address}`。
- **贡献方式**：四个位置都是 `implementation: "none"` 的贡献点，菜单项写在插件描述的顶层 `contributions` 里（同 `settings.properties`）。不需要交空实现；贡献方没有激活时命令不在目录里，这一项自然不显示，与现在标题栏菜单的规则一致。拥有者在激活时读 `context.declarations.list(point)`。

### 2. 标题栏菜单（`workbench.titlebar-menu`，拥有者 `nbook.workbench`）

- 菜单项多一个 `group: "file" | "edit" | "view" | "help"`。四个组的标题与顺序由工作台定；组里没有项时不画。
- `titlebar/menu-model.ts` 的静态定义删掉，`titlebar-source.ts` 改为读这个贡献点。现有条目搬回各自插件的描述，节名与顺序照现在的样子写，搬完后四个菜单与现在逐项一致：
  - 工作台：命令面板、侧栏、右栏、活动栏、面板、面板位置、面板最大化、切换主题、切换明暗、重新载入、文档。
  - 编辑器：保存、全部保存、还原、关闭、关闭其它、撤销、重做、向右分屏、向下分屏、以…重新打开。
  - 作品：打开项目、欢迎。设置：切换界面语言。
  - “退出”现在没有任何插件提供命令、从来画不出来，搬迁时去掉；`desktopOnly` 字段随之删除。以后桌面宿主带上退出命令时由它贡献。

### 3. 视图标题（`ViewDeclaration.actions` 与 `workbench.view-title`，拥有者 `nbook.workbench`）

- `ViewAction` 加 `placement?: "inline" | "menu"`，缺省 `inline`。`menu` 的不画按钮，进标题行末尾的“⋯”下拉（nb-ui `Dropdown`，紧凑档）；“⋯”在“移动到”之前，没有菜单项时不画。
- 新贡献点 `workbench.view-title`：别的插件往某个视图的标题加动作。声明是共同形状加 `view`（视图 id）、`icon`（`inline` 时必填）、`placement`、`args?: "instance"`。按钮的顺序：视图自己的 `actions` 在前（声明顺序），贡献来的在后（按节与顺序）；“⋯”菜单同理。
- `titlebar-source.ts` 的 `viewActions` 合并两路来源；`WorkbenchViewActions` 组件加“⋯”。

### 4. 资源管理器右键（`explorer.context`，拥有者 `nbook.explorer`）

- 声明是共同形状加 `args?: "selection"`、`extensions?`。
- 现有固定项（`explorer/web/menu.ts`）保持原样排在前面：它们的可用与否取决于被右键的那一行与控制器的可用性，不是命令的 `when`，硬改成贡献要先给每条命令补上下文键，收益只是形式统一。贡献来的项在固定项之后，按节分组，节之间画分隔线。
- 根行（“项目”“用户”两个根）只显示合法的根级动作，不加贡献项。

### 5. 编辑区标题（`editor.title`，拥有者 `nbook.editor`）

- 位置：每个编辑组标签条的右侧，按钮加“⋯”，标签多时标签条照旧横向滚动、按钮不跟着滚。
- 声明是共同形状加 `icon`（`inline` 时必填）、`placement`、`args?: "resource"`、`extensions?`。局部上下文是这个组的活动标签：活动标签是文件时给地址与后缀；是页面（欢迎页）时，带 `args: "resource"` 或 `extensions` 的项不显示。
- 点了先把这个组设为活动组，再执行命令：编辑器现有命令作用于活动组，这样在非活动组的标题上点也作用于这个组。
- 第一批使用者：编辑器自己的“向右分屏”（按钮）与“以…重新打开”（“⋯”里）。

### 6. 测试插件（`packages/neuro-book/src/web/testing/`）

现有的 `test.sample-views` 加几条菜单贡献（视图标题的按钮与“⋯”、给样例视图的贡献项），另加一个测试插件 `test.menus`：往 `explorer.context` 与 `editor.title` 各贡献一条带 `extensions: [".md"]` 与参数的项，命令把收到的参数写进公开状态，e2e 读它验证。只在 `NBOOK_TEST_PLUGINS` 里点名时装载，同现有测试插件。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/menus.md`（新建，planned） | 菜单项的共同合同：形状、节与顺序、显示与可用、勾选、局部条件与参数的规则、贡献方式；四个位置各自的定义链到拥有者的 Spec |
| `docs/specs/ui/workbench-shell.md` | 外壳四输出 29：标题栏菜单的条目来自 `workbench.titlebar-menu`，组由工作台定 |
| `docs/specs/workbench/views.md` | 输出 10：`placement`、“⋯”菜单与 `workbench.view-title` |
| `docs/specs/workbench/files-explorer.md` | “随第一个消费者再做”改为 `explorer.context` 的定义 |
| `docs/specs/workbench/editor.md` | 新增编辑区标题与 `editor.title` |
| `docs/specs/runtime/plugin-hot-plug.md` | 场景里的 `explorer/context` 改为新名字 |
| `docs/specs/README.md` | 登记 `menus.md` |

## 切片

| 片 | 对应设计 | 自跑验证 |
|---|---|---|
| S0 | Spec 改动表 | `docs:check`、`governance:check` |
| S1 | 第 1 节：共同合同与 `arrangeMenu` | `typecheck`、`test:affected` |
| S2 | 第 2 节：标题栏菜单改为贡献，条目搬回各插件 | 同上；`workbench-titlebar.e2e.ts` |
| S3 | 第 3 节：视图标题“⋯”与 `workbench.view-title` | 同上；`workbench-views.e2e.ts`、Lab 场景 |
| S4 | 第 4 节：资源管理器右键 | 同上；`files-explorer.e2e.ts` |
| S5 | 第 5、6 节：编辑区标题与测试插件 | 同上；`editor-area.e2e.ts`、Lab 场景 |
| S6 | — | 全套 e2e、`lab:shot`、omp 实现审查与修正、证据与 Spec 实现合同 |

## 验收映射

| 行为 | 测试 |
|---|---|
| 节与顺序、空节不画、命令不在目录里不显示、`when` 隐藏、可用与原因、快捷键、勾选、`extensions` 与多选、参数只在声明时传 | `commands/shared/menus.test.ts`（纯函数，真实命令服务的元数据） |
| 声明校验：id 前缀、未知字段、`inline` 缺图标、在没有当前文件的位置写 `extensions` | 同上的校验一组 |
| 搬迁后四个标题栏菜单与现在逐项一致；贡献方停用后它的项消失 | `titlebar/menu-model.test.ts` 改写（真实内核装各插件描述）；`workbench-titlebar.e2e.ts` 现有用例不改照样通过 |
| 视图标题：`menu` 的动作进“⋯”，别的插件给样例视图加的按钮与菜单项出现、执行时带实例 | `WorkbenchShellParts.dom.test.ts`；`workbench-views.e2e.ts` 新增一例 |
| 资源管理器右键：贡献项排在固定项之后，`.md` 才出现，执行时收到选中的地址；根行没有贡献项 | `FilesExplorerView.dom.test.ts`；`files-explorer.e2e.ts` 新增一例（`test.menus`） |
| 编辑区标题：分屏按钮与“⋯”里的“以…重新打开”；`.md` 标签才出现测试插件的按钮，点了收到地址；在非活动组上点作用于那个组；欢迎页上带参数的项不显示 | 编辑组的组件测试；`editor-area.e2e.ts` 新增一例 |

## 验证

- 每片：`typecheck`、`test:affected --typecheck`，并跑受影响的 e2e。
- 收口：全套 e2e；`lab:shot` 跑视图标题与编辑组相关场景；`docs:check`、`governance:check`。
- 未验证的边界：插件运行期启用与禁用（热插拔）时菜单项的增减，随热插拔一起做；现在只验证“贡献方入口没激活时项不显示”。

## 不做与风险

- 不做：子菜单（标题栏收拢后的 ≡ 已按组分级）；按住 Alt 换命令；视图实例上报的忙碌态；编辑器标签右键与正文右键；按语言过滤。
- 风险：标题栏条目搬迁容易漏项或换顺序。用改写后的 `menu-model.test.ts` 钉住四个菜单的完整内容，与搬迁前逐项比对。
- 风险：编辑区标题占了标签条右侧的宽度，窄窗口里标签更早开始滚动；按钮个数少（第一版一个按钮加“⋯”），在 390px 宽下用 e2e 检查不溢出。
