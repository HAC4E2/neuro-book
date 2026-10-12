# t80 实施计划：设置界面与贡献点

## Context

- **为什么做**：开发者决定先做纯前端的旧功能迁移，设置界面第一个。`nbook.settings` 已有配置合同（[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)），但设置界面、用户编辑的写入路径只定了合同；设置声明也缺界面要的字段。旧设置的规模（模型服务、Agent Profile 两个自定义两栏页，密钥、可排序列表、项目层只覆盖部分字段）见 [旧设置清单](legacy-settings-inventory.md)。
- **已确认的决定**（编号同 [README](README.md)）：浮动窗口加左侧分区；每项标题在左、控件在右；入口和头像放在一起；顶部切换“用户 | 本作品”；不做“启动”档，“本机”层只留合同；编辑器偏好放用户层；贡献点按草案；自定义整页本 Task 实现、示例插件当使用者；编辑器分区排在 t79 之后。
- **稿子**：各轮静态稿与贡献标注稿在本机评审板 `.local/design-review/t80-settings-ui/index.html`（不入库），设计决定的文字记在 README。
- **后来确认的**：窗口固定宽 960×640（不按页面变宽）；入口用 P1（齿轮单独放在头像旁边）。每项的排法在 960 宽下再比一轮（README 待定第 11 条），下文第 4 节按“标签列加控件列”写，定了再改。
- **工作方式**：主 Agent 写计划、审 diff、自己跑验证与决定验收；每片派一个编码子代理（opus）在 `.worktree/w00017-t80-settings-ui` 实施，同一时间只有一个子代理写代码。每片连同它的 Spec 与组件文档一起提交。收尾交 omp 审查。

## 关键设计

### 1. 设置声明补字段（`src/shared/settings.ts`）

`defineSetting` 新增可选字段，登记期校验（不合格的声明以 `invalid-declaration` 被拒，规则同现有第 1 条）：

| 字段 | 规则 |
|---|---|
| `section` | 分区 id（见第 2 节）；缺省或指向的分区不存在时，这一项归入“其它”分区，按声明者插件分小组；指向不存在的分区时记一条诊断 |
| `group` | 分区里的小组 id，须是该分区声明的小组；缺省排在分区最前、没有小标题；指向不存在的小组时同缺省并记诊断。小组 id 是分区声明的公开合同，别的插件按 id 引用 |
| `order` | 小组内的顺序，同值按键 |
| `choices` | `[{value, title, description?}]`：schema 是若干字面量的联合时给每个字面量一个中英标题；必须和字面量一一对应，否则声明被拒 |
| `applies` | `"now"`（缺省）、`"next-run"`、`"next-session"`、`"restart"`：取代现在的 `restart` 布尔，界面在标题后标“下次运行生效”等 |

- 现有四项补上：主题、明暗、界面语言给 `choices` 与 `section: "nbook.appearance"`；作品目录给 `section: "nbook.works"`。主题的说明“界面的形状、字体与配色”。
- `restart` 字段删除，现有声明里没有 `restart: true` 的项。
- 路径类的项暂不加控件提示：目录选择要用作品插件的 `browse`，设置插件不依赖它；等有平台级的选择目录服务（例如桌面端的原生对话框）再加 `format: "directory"`。在那之前，这类项由所属插件贡献整页（第 6 节）。

### 2. 贡献点 `settings.sections`（`plugins/settings/shared/point.ts` 一带）

拥有者 `nbook.settings`，只接受浏览器入口的贡献。分区 id 规则同视图：`nbook.*` 插件写 `nbook.<名>`，其它插件以自己的插件 id 加 `.` 开头（例如 `example.snippets.main`）。

```ts
interface SettingsSectionDeclaration {
    readonly title: LocalizedText;
    readonly description?: LocalizedText;  // 分区标题下的一行说明
    readonly icon: string;                 // 图标类名
    readonly category: "app" | "ai" | "plugins";  // 左栏分组：应用、AI、插件，组间一条分隔线，没有组标题
    readonly order?: number;               // 组内顺序，同值按 id
    readonly kind: "list" | "page";
    readonly groups?: readonly {id: string; title: LocalizedText}[];  // 只给 list
    readonly layout?: "column" | "fill";   // 只给 page，缺省 column
    readonly layers?: readonly ("user" | "project")[];                // 只给 page：在哪些标签下可用，缺省两者
}
// kind: "page" 时 implementation: "required"
interface SettingsPageImplementation {
    load(): Promise<Component>;            // props：{context: SettingsPageContext}
}
interface SettingsPageContext {
    readonly id: string;
    readonly layer: Readonly<Ref<"user" | "project">>;   // 当前标签，切换标签时变化；页面只编辑这一层
    readonly projectTitle: Readonly<Ref<string | null>>;  // 绑定作品的书名，没有绑定时为 null
}
```

- **外壳画什么**：每个分区顶部的标题与说明都由设置窗口画。`list` 与 `layout: "column"` 的页面放在同一个内容列里（同样的内边距与封顶宽度，内容列滚动）；`layout: "fill"` 的页面拿到标题下面的整块区域（外边距与内容列相同，不封顶），自己分栏、自己滚动。
- **list**：设置窗口按 schema 画出 `section` 指向它的配置项。
- **page**：插件自己画；用自己插件的 `settingsKey` 读写自己声明的项，写入带 `{layer: context.layer.value}`。指向 page 分区的配置项不在列表里画，由页面负责。
- **标签下可用**：list 分区在“本作品”标签下可用的条件是至少一项允许本作品层；page 分区看声明的 `layers`，由页面作者让它与页面里配置项的层一致。不可用的分区在左栏停用并以原因作提示。
- page 的交付状态照 [`workbench.views`](../../../../../docs/specs/workbench/views.md) 输出 2（声明、受阻、失败、撤回、可用），原位呈现，一个页面出错不影响别的分区。
- **给页面用的组件**：`nbook/plugins/settings/web/contracts` 导出 `SettingsRow`（`settings`、`setting`、`layer` 三个属性，控件放在插槽里）。已修改竖线、恢复默认（经传入的 `settings` 删除这一层的键）、用户标签下的“本作品覆盖”提示、层无效或不可达时停用，都由它按设置定义与层自己算，页面不重写。另导出页内列表 `SettingsPageList`（给 fill 页面做二级列表，选中样式与左栏不同，免得两层左栏读成一张表）。
- **内置分区**：`nbook.appearance`“外观”（nbook.settings，app 组，list：小组“界面”放主题、明暗，小组“语言”放界面语言）；`nbook.works`“作品”（nbook.projects，app 组，column 页面，见第 6 节）；“其它”是设置窗口自己的，不是贡献，没有项时不出现。

### 3. 用户编辑的写入路径（configuration 输出 19）

层拥有者的远程服务加 `edit`、`unset` 两个方法：写任何已声明项的允许层；只接受内核填写的调用方是 `nbook.settings` 且没有经过代理的请求，其余为 `denied`；校验与审计同 `set`、`remove`，审计记“用户编辑”。设置窗口的通用列表只走这条路径。输出 19 晋升，`configuration.md` 不再是“只定合同”。

### 4. 设置窗口（`plugins/settings/web/`）

- **一个页面一个窗口**：命令 `nbook.settings.open`（参数 `section?`、`layer?`，默认键位 `Ctrl+,`）打开或聚焦本页的设置窗口并跳到指定分区；公开状态 `nbook.settings/windowOpen`。关掉再开回到上次的分区与标签；刷新后回到第一个分区、用户标签。
- **外框**：nb-ui `Dialog`（`modal=false`），缺省 960×640、可拖动调整大小，尺寸记在 `nbook.settings` 的客户端本地记录里（位置不记，每次居中）；切换分区时窗口不变大小；左栏约 180px 分区导航（三组，组间分隔线），右边一次只显示一个分区。
- **用户 | 本作品**：窗口标题下、左栏上方的分段控件，只在绑定作品的窗口出现，缺省“用户”。
- **通用控件**：布尔用开关；有 `choices` 的字面量联合不超过 3 项用分段控件，多于 3 项用下拉；数字用数字输入框，范围与步长取 schema；字符串用输入框，长度取 schema；数组、对象等画不了的类型只读显示“只能在设置文件里改”与当前值摘要。排法是标签列加控件列：标签列约 200px（标题与说明），控件紧跟其后、左对齐，宽度按类型定。
- **已修改**：当前标签这一层写了这个键就算改过，标题左侧强调色竖线，控件后面“恢复默认”（从这一层删掉这个键）。
- **用户标签里被本作品覆盖的项**：行下一行信息色提示“本作品单独设为了 X，这里的改动在《书名》里不生效”。
- **本作品标签**：本作品层没写的项显示“沿用用户设置：X”和“在本作品里单独设置”（把当前有效值写进本作品层）；写了的项显示控件和“移除本作品的设置”。只允许用户层的项不列出，分区末尾一行淡色字说明。
- **层的状态**：层 `invalid` 时分区顶部一行说明“设置文件有错误，修好前这里不能保存”和文件路径，这一层的控件停用、显示上一份有效值；`unavailable` 时说明“暂时连不上，不能保存”，控件停用；恢复后自动解除。
- **写入结果**：成功不提示；失败用工作台通知（与书架“作品目录没写进设置”一致），控件回到层里的实际值；`unknown-outcome` 提示“可能没有保存，以设置文件为准”。
- **键盘**：左栏上下键切分区；Esc 关窗口，焦点回到打开前的位置。
- 只做桌面宽度。

### 5. 工作台的两个贡献点（`plugins/workbench/`）

- **活动栏底部条目 `workbench.activitybar-items`**：外壳 Spec 输出 15 的“底段全局项”改为可贡献（外壳设计稿原文“全局项以后可贡献，随账号、设置插件”）。声明 `{title, icon, order, command?: {id, args?}, when?, toggled?}`，纯声明、没有实现；按 `order` 从上往下排在活动栏底部；`toggled` 是公开状态的布尔键，为真时按钮画成按下（灰底、图标正文色，不用强调色）；没有 `command` 的条目不可点，以 `title` 作提示；命令不可用时禁用并以原因作提示。
  - nbook.settings 贡献齿轮（`order: 1000`，`nbook.settings.open`，`toggled: nbook.settings/windowOpen`），在最下面。
  - nbook.workbench 贡献头像占位（`order: 900`，没有命令，提示“个人资料尚未开放”）；账户插件迁回时由它贡献真正的头像并删去占位。
- **页面浮层 `workbench.overlays`**：插件交一个组件，工作台在页面根（`WorkbenchDocument`）上挂一份。书架是首页贡献、放在同一个页面根里，所以首页与工作台页都有、每个浏览器窗口各一份。声明 `{order?}`，实现 `{load(): Promise<Component>}`，失败只影响这一个浮层并记诊断。设置窗口经它挂载。

### 6. 作品分区与书架入口（`plugins/projects/`）

- **作品分区是 `nbook.projects` 贡献的 column 页面**（`layers: ["user"]`）：作品目录一行用 `SettingsRow`，控件是路径文字加“更改…”，打开书架的目录选择器（`PathPickerDialog`），写入用自己的 `settings.update(librarySetting, path, {layer: "user"})`。没设时显示“还没设，第一次新建作品时会记下”。
- **书架入口**：右上角的设置下拉菜单删掉，换成一个齿轮按钮，紧挨在头像左边，点了执行 `nbook.settings.open`，窗口开着时读 `nbook.settings/windowOpen` 画成按下；“切换主题、明暗、界面语言”三条命令照旧在命令面板与工作台“视图”菜单里。头像占位不动。

### 7. 示例插件（`packages/neuro-book/examples/`）

新增 `example.snippets`“常用片段”：配置项 `example.snippets/items` 是 `{name, text}` 的数组（用户与本作品两层），通用列表画不了，所以贡献一个 column 页面（分区 `example.snippets.main`，plugins 组）：列表加增删改、上下移动；按 `context.layer` 只编辑这一层，本作品层没写时显示“沿用用户设置”与“在本作品里单独设置”。教学注释讲什么时候用整页、怎样按层读写、为什么用 `SettingsRow`。场景测试 `06-settings-page.test.ts` 核对声明被接受、页面交付与撤回、按层写入与越权写入被拒；Lab 场景把设置窗口与这个页面挂在一起供人看。

## Spec 与文档改动

| 文档 | 改什么 |
|---|---|
| `docs/specs/settings/configuration.md` | 声明字段表（`section`、`group`、`order`、`choices`、`applies`，删 `restart`）与登记期校验；输出 19 实现（`edit`、`unset`）；不承诺里“本机层”改写为 planned 条目：只本机生效的项，随桌面端实现 |
| `docs/specs/settings/settings-window.md`（新，capability `settings.window`） | 设置窗口的行为（第 4 节）、贡献点 `settings.sections`、页面上下文、`SettingsRow` 与 `SettingsPageList` 的公开入口 |
| `docs/specs/ui/workbench-shell.md` | 输出 15 底段全局项改为贡献点 `workbench.activitybar-items`；新增 `workbench.overlays` |
| `docs/specs/workbench/bookshelf.md` | 输出 1 顶部右侧（齿轮按钮代替设置菜单）；作品分区 |
| `docs/specs/README.md` | 登记新 Spec |
| 组件同名 `.md` | 设置窗口、`SettingsRow`、`SettingsPageList`、活动栏、作品分区页、示例页 |
| `examples/README.md` | 第六个场景与阅读顺序 |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 | 前置 |
|---|---|---|---|---|
| S1 | 1、2、3 | 声明字段与校验、`settings.sections` 贡献点与登记、用户编辑写入、现有四项补字段；两份 Spec 的合同部分 | 设置插件全部测试、新增声明与贡献点测试、越权写入测试；两包 typecheck | 无 |
| S2 | 4 | 设置窗口、`SettingsRow`、`SettingsPageList`、命令与公开状态、外观分区；Lab 场景（两标签、已修改、被覆盖、层无效、不可达、写入失败、page 交付的五种状态、column 与 fill 页面） | 组件测试；`lab-scenes.e2e.ts`；改动组件 `lab:shot` | S1 |
| S3 | 7 | 示例插件、场景测试、Lab 场景 | `bun test examples`；Lab 场景截图 | S2 |
| S4 | 5、6 | 两个工作台贡献点、齿轮与头像占位、浮层挂载、作品分区页、书架入口 | 工作台与书架测试；`workbench-*.e2e.ts`、`bookshelf.e2e.ts`、`settings.e2e.ts` 扩展 | S2；t78 与 t79 S2 已提交，本分支先对齐 |
| S5 | — | 全量 e2e、截图证据、omp 实现审查与修正 | `test:affected --typecheck`、全量 e2e、`docs:check`、`governance:check` | S4 |

S1–S3 只动设置插件、共用声明、示例与 Lab，与 t78、t79 不重叠，可以现在做；S4 改活动栏与书架顶部，t78 正在改活动栏尺寸、t79 S2 要把外壳改平铺，等它们提交后对齐再做。nb-ui 的 `SegmentedControl` 截断与字号缺陷归 [t81](../t81-nb-ui-text-size-segmented/README.md)：S2 先给分段控件足够的宽度。

## 验收映射

| 行为 | 由谁覆盖 |
|---|---|
| 不合格的分区、小组、`choices`、`applies` 声明被拒，同插件其它贡献照常；指向不存在的分区或小组的项落到“其它”或分区最前，并记诊断 | 声明测试 |
| 别的插件调用 `edit` 为 `denied`，经代理的 `nbook.settings` 请求也为 `denied` | 写入路径测试 |
| 工作台齿轮与书架齿轮、`Ctrl+,` 都打开同一个窗口；再触发只聚焦；齿轮在窗口开着时画成按下 | `settings.e2e.ts` |
| 用户标签改主题，所有窗口即时变化；本作品标签单独设明暗后，用户标签出现覆盖提示；移除后提示消失 | `settings.e2e.ts`（真实服务端与项目实例） |
| 改过的项有标记，恢复默认后键从文件里删掉、其余内容不变 | 组件测试；`settings.e2e.ts` 读文件 |
| 文件改坏时分区顶部出现说明、控件停用；修好后恢复 | `settings.e2e.ts` |
| 写入失败发通知、控件回到实际值 | 组件测试（只读文件） |
| 拖动调整窗口大小后关掉再开、刷新后仍是这个尺寸 | 组件测试或 `settings.e2e.ts` |
| 自定义页面按层读写；切换标签后页面拿到新的层；页面加载失败原位显示、别的分区照常 | 示例场景测试；组件测试 |
| 作品分区“更改…”打开目录选择器，选定后写进设置 | `bookshelf.e2e.ts` 或 `settings.e2e.ts` |
| 全部 Lab 场景无溢出、无裁切 | `lab-scenes.e2e.ts` 门禁 |

## 验证

- 每片按上表自跑；收尾全量 e2e 两轮、`lab-scenes` 门禁、变异检查（每条核心行为退回一次确认测试失败）。
- 真实浏览器观察：开发会话里从书架与工作台各打开一次，走一遍改主题、本作品覆盖、恢复默认、文件改坏，nbook 与 macos 明暗各截一组存 `evidences/`。
- 未验证边界：手机宽度不做；桌面版 WebKit 只做静态核对。

## 不做与风险

- 不做：搜索（到几十项时再加）；密钥项界面（随第一个密钥使用者）；本机层；编辑器分区（t79 之后）；模型服务、Agent 等分区（随功能迁回）；打开设置文件的按钮（用户层文件不在 `user://` 根下，编辑器打不开）；用户自定义快捷键；路径类控件提示。
- 风险：
  - 自定义页面的合同只有作品分区与示例两个使用者，模型服务迁回时可能还要加上下文字段（例如 fill 页面要求的最小宽度）；合同只追加，不改已有字段。
  - S4 要在 t78、t79 S2 之后对齐，两者都改活动栏；对齐时以它们的外观为准，本 Task 只加底段条目。
  - 删除 `restart` 字段影响声明的公开写法；现在只有内置插件声明配置，没有第三方使用者。
