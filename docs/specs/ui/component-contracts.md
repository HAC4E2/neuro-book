---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: ui.component-contracts
owners:
  - ui
---
## 背景

NeuroBook 是一个基于 Vue 3 + Nuxt 3 的 AI 辅助工作空间产品，支持多会话管理（Session）、项目组织（Project）、大模型服务接入（Provider/Model）和持久化状态（Pinia store + storage）。

当前主应用的 UI 组件分散在产品源码中，包括 232 个 Vue 单文件组件（SFC）。为了提高复用性和可维护性，需要将可复用的 UI primitive 迁移到 monorepo 内的公共组件包 `@notnotype/nb-ui`。

本规范定义这些产品组件的行为合同、唯一 catalog 索引、状态管理和迁移删除门禁，确保迁移过程中产品行为不变，旧入口在全部消费者切换后才删除。

frontmatter 字段说明：`schema: nbook.spec/v1` 表示遵循 NeuroBook 规范格式 v1 版；`kind: behavior` 表示这是行为规范（相对于数据规范或架构规范）；`capability: ui.component-contracts` 是本规范在项目中的唯一标识符；`status: planned` 表示规范已批准但尚未实现。


# UI 组件合同

## 目标与非目标

目标：

- 为NeuroBook用户界面组件提供统一、可审查的行为合同，使产品组件可以按明确的输入、输出、状态、可访问性和响应式要求被分类、迁移与验收。
- 为全部产品组件提供唯一catalog状态，使调用方能够区分尚未具备验收证据的组件与可由正式界面或确定性fixture验证的组件。
- 迁移到公共UI能力时，保持产品可观察行为，并在全部消费者切换后删除旧入口。

非目标：

- 本规范不承诺所有组件都迁入公共组件包，也不要求产品专属composite或workspace组件成为通用primitive。
- 本规范不定义主题切换、Workbench/View Host、第三方扩展、产品数据模型或服务端API。
- `planned`状态不表示catalog、公共组件接入、浏览器验收或旧入口删除已经实现。

## 术语与参与者

- **组件合同**：调用方与用户能够观察到的组件行为，包括 Vue props（输入属性）、emits（自定义事件）、slots（内容插槽）、键盘操作、焦点顺序、ARIA（Web 无障碍属性，如 `aria-label`、`role`）、状态、布局和错误处理。
- **catalog**：NeuroBook 产品组件的唯一索引，记录每个组件的 ID、来源路径、分类、状态和依赖。每个产品组件只有一个条目，并且该条目恰好属于一个 owner 分区（见下文 owner 定义）。
- **presentational**：只接收受控值（由父组件通过 props 传入的数据）和显示输入（用于渲染的静态内容），不持有产品业务数据、不发起网络请求、不执行业务副作用（如写数据库、修改全局状态）的展示型组件。
- **composite**：组合多个 UI 能力（指可复用的 UI 组件或函数，如按钮、表单控件、布局容器），可持有局部交互状态（如展开/收起、当前选中项），但产品数据和外部副作用（API 调用、持久化写入）由宿主（指调用该组件的产品代码，如 workspace 组件或页面）提供。
- **workspace**：编排 Project（NeuroBook 中的项目单元，包含多个文件和配置）、Session（一次对话会话，包含消息历史和上下文）、API（后端服务接口）、Pinia（Vue 全局状态管理库）、storage（浏览器本地存储或 IndexedDB）或持久化状态的产品界面，通常是完整的产品页面或视图。
- **pending**：catalog 条目尚无足够的确定性 fixture（测试夹具，指可复现的输入数据和交互场景）或正式界面证据（在产品中真实运行的界面），不能在 Lab（组件检视工具，见 component-lab.md）中宣称可验收。
- **ready**：合同、确定性 fixture 或正式界面证据以及所需验证已经闭合（指证据已提交、验证已通过、相关 Task 已完成）。
- **组件 owner**：负责该 catalog 条目状态、合同证据和迁移关闭条件的唯一 UI 领域（如 owner A 负责基础表单控件、owner B 负责数据展示组件）。owner 是条目所属唯一分区的关系，不是 `NeuroBookComponentCatalogEntry` 类型的重复字段——每个条目通过其在对应 owner slice（分区文件）中的位置确定归属，唯一 aggregate（聚合模块）负责合并各 owner 的 slice 并提供 `entry → owner` 查询能力。
- **公共 UI 能力**：指 monorepo 内 `@notnotype/nb-ui` 包提供的可复用 UI primitive（基础组件，如 Button、Input、Dialog）及其公开 exports（导出的组件、composable 函数、主题变量）。「公共组件包」「公共 primitive」「公共 UI 入口」均指该包的正式导出，是同一事物的不同说法。
- **旧入口**：迁移前产品源码中的本地组件实现及其 import 路径（如 `~/components/Button.vue`）。
- **公开入口**：迁移后 `@notnotype/nb-ui` 的正式 export（如 `import { Button } from '@notnotype/nb-ui'`）。
- **迁移边界**：一组需要同时切换的组件和消费者，由 Task（开发任务，如 A Task 负责基础表单控件迁移）定义并验证；同一边界内的消费者必须一起切换到公开入口，不得部分保留旧入口。
- **alias**：为旧路径创建的别名导出，使旧 import 仍然有效。
- **adapter**：在旧接口和新接口之间转换的适配层。
- **fallback**：当新入口不可用时自动回退到旧实现的机制。
- **Workbench/View Host**：NeuroBook 产品的界面框架概念（Workbench 指工作台主界面，View Host 指视图容器），不在本规范范围内。
- **aggregate**：聚合各 owner slice 的唯一模块，负责合并 catalog 条目、校验唯一性、提供统一查询接口。与「聚合视图」同义。
- **registry**：组件索引的存储结构。catalog 是唯一 registry；「第二 registry」「双 registry」「第二 catalog」「第二真相源」均指违反唯一性原则的重复索引，是禁止的。

## 输入与前置条件

每个 catalog 条目必须提供以下字段：

- **稳定 ID**：在迁移期间不变的组件标识符。
- **source 标识**：产品内的虚拟路径（如 `nbook/app/components/Button.vue`），可无损映射到物理文件。
- **label**：用户可读的组件名称。
- **group**：组件分组（如 `form`、`layout`、`data-display`）。
- **parent**：父级分组或父组件 ID，形成树形结构，不得形成环。
- **tier**：分层（取值为 `presentational`、`composite` 或 `workspace`）。
- **maturity**：成熟度（如 `experimental`、`stable`、`deprecated`）。
- **status**：当前状态（`pending` 或 `ready`）。
- **description**：组件用途描述。
- **外部依赖分类**：声明组件依赖的外部能力（取值如 `api`、`pinia`、`storage`、`provider`、`model`，或 `none`），fixture 不得获取这些依赖的真实实例。

每个条目还必须恰好归入一个 owner 分区。唯一 aggregate 必须能由条目解析并查询该 owner，但不得把 owner 复制进 entry 或创建第二 registry。`pending` 条目必须提供具体阻塞原因（如"缺少 fixture"、"合同未定义"）；`ready` 条目必须提供可定位的确定性 fixture 或正式产品界面证据。

组件合同必须明确以下内容：

- **受控值**：由父组件通过 props 传入、组件自身不修改的数据。
- **可选值**：可以不传、有默认值的 props。
- **事件**：组件 emit 的自定义事件及其 payload。
- **slot**：内容插槽的名称和用途。
- **状态**：`disabled`（禁用）、`readonly`（只读）、`loading`（加载中）、`error`（错误）等状态的视觉和交互行为。
- **键盘操作**：支持的快捷键（如 Enter 提交、Escape 关闭）。
- **焦点顺序**：Tab 键导航顺序。
- **ARIA 名称与关系**：如 `aria-label`、`role`、`aria-describedby`。
- **布局影响**：最小/最大尺寸、overflow 规则（CSS overflow 属性，控制内容溢出时的滚动或裁剪行为）。

不适用的状态必须明确为不支持，不能由实现者猜测。

产品组件进入 catalog 前必须属于 NeuroBook 产品组件范围（指主应用 `packages/neuro-book` 内的 Vue 组件，不包括页面、应用根组件 `App.vue`、开发 Lab 自身以及越界文件，如构建脚本、配置文件）。source 标识必须可无损映射到一个产品组件，禁止 basename 猜测或多个物理文件共享同一 source。

## 输出与可观察行为

- 调用方可以通过唯一 catalog 查询组件的分类、owner、依赖、状态和证据，并通过同一 aggregate 查询条目所属的唯一 owner 分区；不会从第二份 registry 或 entry 内重复 owner 字段得到冲突结果。
- `pending` 条目不会被呈现为可交互 Lab 场景；调用方能够看到具体阻塞原因。
- `ready` 条目具有稳定场景，用户可观察默认、交互、禁用、错误、键盘、焦点和响应式行为中适用的部分。
- 组件在桌面（≥1440px）与 `390×844` 窄屏（phone 视口）下保持核心操作可完成；标签、按钮、浮层（指 tooltip、弹窗、下拉菜单等浮动在页面上层的 UI 元素）和动态内容不得发生不可理解的重叠或页面级横向溢出。
- 会改变尺寸的状态不得导致未声明的布局位移（指在合同中未明确说明、用户不预期的元素移动，如突然出现的 banner 推开内容）；固定格式控件（指日期选择器、时间输入等有固定尺寸和格式的表单控件）使用稳定尺寸约束。
- 迁移公共 primitive 时，全部消费者（指调用该组件的产品代码文件）在同一迁移边界内切换到公开入口；同名本地实现不会作为 alias、adapter 或可选 fallback 继续存在。
- 产品专属 composite 和 workspace 组件可消费公共 primitive，但其数据 owner（指拥有业务数据读写权限的模块）、权限、持久化和副作用仍留在产品宿主。

## 状态与转换

| 当前状态 | 事件 | 下一状态 | 可观察结果 |
|---|---|---|---|
| 未登记（组件存在于产品源码但尚未进入 catalog） | 产品组件进入受管范围（通过 Task 决定并登记） | `pending` | 创建唯一 catalog 条目并给出具体阻塞原因；不宣称可验收。 |
| `pending` | 合同、fixture 或正式界面证据与所需验证闭合 | `ready` | 条目可由 Lab 或正式界面稳定访问，证据指向唯一场景。 |
| `pending` | source、owner 或行为仍有歧义 | `pending` | 保持阻塞并报告歧义，不选择静默默认。 |
| `ready` | 行为合同发生变化 | `pending` | 旧证据失效，重新阻塞直至新合同与验证闭合。 |
| `ready` | 全部消费者迁移且旧入口删除条件满足 | `ready` | 唯一公开入口生效，旧实现和旧引用归零。 |
| 任意状态 | owner 切片被移除或回滚 | 原状态或未登记 | 只回滚该 owner 的条目与证据，不生成第二 catalog。 |

状态转换按条目串行评审。并行迁移不得由两个owner同时修改同一条目；发生冲突时保持原状态并停止关闭。

## 副作用与数据

catalog 与合同是版本控制内的静态产品元数据，不写用户数据、不访问网络、不启动外部进程，也不取得 Project、Session、API、Pinia 或 storage 所有权。

组件 fixture 只能使用确定性、脱敏且有边界的数据。组件自身的外部副作用必须通过受控事件（指组件 emit 的自定义事件，由父组件监听并处理）或宿主提供的端口（指父组件通过 props 传入的回调函数或 composable 函数）表达；catalog 状态不能触发产品写入（指修改业务数据库、Pinia store、storage 或发起 API 请求）。

删除旧入口是迁移副作用：只有所有静态消费者（编译时可确定的 import 语句）、动态消费者（运行时通过 `resolveComponent` 等动态加载的组件）和测试消费者（测试文件中的引用）都已切换并满足对应合同后才执行。删除不得由运行时 alias、双队列（指同时维护旧队列和新队列的过渡机制）、双 registry 或静默 fallback 替代。

## 失败与恢复

- source 无法唯一映射、parent 缺失或形成环、ID 重复、条目不属于恰好一个 owner 分区（即得到零个或两个及以上 owner）、依赖分类缺失时，catalog 验证失败并拒绝状态晋升。
- `pending` 缺少阻塞原因或 `ready` 缺少证据时，保持或恢复为 `pending`。
- 组件行为、可访问性、响应式或正式界面证据与合同冲突时，迁移停止；修正实现或经批准更新同一 Spec 后重新验证。
- 公共 UI 入口不能覆盖现有产品行为时，不得用 alias、adapter、双入口（指同时保留旧路径和新路径两个导出）或静默 fallback 掩盖；应保持旧入口并报告公共合同缺口（指新组件缺少的 props、事件或行为，需补充或调整合同）。
- 任一迁移切片（指由 owner 负责的一组组件，如 A 切片包含基础表单控件）可通过恢复该切片之前的唯一 catalog 状态和入口回滚，不影响其它 owner 已验证条目。

## 边界与兼容

UI 模块（指 monorepo 内的 `@notnotype/nb-ui` 包及其相关代码）拥有组件合同和 catalog；产品领域（指主应用 `packages/neuro-book` 内的业务代码）继续拥有 API、Project、Session、Pinia、storage、权限和持久化语义。公共组件包只拥有可复用 UI primitive 及其公开行为。

catalog 的组件 source 采用稳定产品标识（虚拟路径如 `nbook/app/components/Button.vue`），不暴露机器绝对路径。每个条目只存在于一个 owner 分区；聚合视图组合并校验条目，同时提供 `entry → owner` 唯一查询关系，但不能把 owner 写回 entry 或复制记录形成第二真相源。

迁移必须使用公共包正式 exports；禁止深层私有 import（如 `@notnotype/nb-ui/dist/internal/Button`）。名称相同不等于合同兼容，切换前必须核对 props、emits、slots、键盘、ARIA、SSR（Server-Side Rendering，服务端渲染，Nuxt 在服务端预渲染组件时的行为）、CSS 和浮层行为。

本规范不改变现有主题合同（指 `docs/specs/theme/system.md` 定义的主题变量、颜色、字体等规范）。主题能力发生迁移时必须更新 `theme.system` 同一 Spec，不能在组件 catalog 内建立第二颜色 authority（指颜色定义的第二真相源）。

## 验收与 Smoke

1. Given 当前 NeuroBook 产品组件集合，When 读取 catalog，Then 每个受管组件恰有一个条目，source 可双向定位，无重复、遗漏、越界、缺失 parent 或环。
2. Given 任一 catalog 条目，When 通过唯一 aggregate 查询 owner，Then 得到且只得到一个 owner 分区；entry 本身不含重复 owner 字段，分区并集与条目全集精确一致。
3. Given 任一 `pending` 条目，When 调用方读取状态，Then 存在具体阻塞原因，且该条目不会被宣称为可交互 Lab 场景。
4. Given 任一 `ready` 条目，When 打开其确定性 fixture 或正式界面，Then 默认、交互、禁用、错误、键盘、焦点和响应式合同中适用的部分均可观察且与合同一致。
5. Given 桌面（≥1440px）与 `390×844` 视口，When 完成组件核心操作，Then 无页面级横向溢出、不可理解重叠或动态内容引起的未声明布局位移。
6. Given 组件依赖 API、Pinia 或 storage，When 审查 catalog 和 fixture，Then 依赖被显式分类（外部依赖分类字段取值为 `api`、`pinia`、`storage`、`provider`、`model` 或 `none`），fixture 不取得真实产品数据 owner（指 fixture 不能访问真实的业务数据库、Pinia store 实例或 API 端点）。
7. Given 公共 primitive 迁移，When 所有静态、动态和测试消费者完成切换，Then 旧入口、旧样式和旧引用归零；任一消费者未切换时删除门禁失败。
8. Given 合同或 source 集合发生变化，When 旧证据不再覆盖当前行为，Then 对应条目回到 `pending` 并报告原因，不静默沿用旧证据。

## 证据

- 批准依据：开发者明确批准闭合 `t01-migration-design` 并创建本 `planned` Spec；未批准实现。
- 当前设计证据：[t01 迁移设计 Task](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t01-migration-design/README.md)。
- 组件基线：[component-baseline.json](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t01-migration-design/evidences/component-baseline.json)（232 个组件条目）。
- 调用方与删除门禁：[surface-caller-migration-map.json](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t01-migration-design/evidences/surface-caller-migration-map.json)（29 个迁移表面的 caller 证据）。
- 本 Spec 尚未实现；产品源码、依赖、catalog 类型定义、fixture 和浏览器验收均不因 `planned` 状态而存在或通过。
