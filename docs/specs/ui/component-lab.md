---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: ui.component-lab
owners:
  - ui
---
## 背景

NeuroBook 是一个基于 Vue 3 + Nuxt 3 的 AI 辅助工作空间产品。当前主应用包含 232 个 UI 组件和 14 个 preview 源（指旧的组件演示页面，位于 `app/pages/preview/` 目录），共 31 个稳定 scenario（具体的组件展示场景）。

为了将可复用组件迁移到 monorepo 内的 `@notnotype/nb-ui` 包，需要一个开发环境专用的组件检视工具（Lab），用于：

1. 用确定性 fixture（可复现的测试输入）观察组件合同（props、事件、状态等行为规范，见 component-contracts.md）。
2. 将 31 个 scenario 分为两类：26 个 `demo-only`（可用 fixture 完整表达）迁入 Lab；5 个 `product-behavior`（需真实业务能力）迁入正式产品界面。
3. 确保 Product 构建（可分发的桌面客户端或服务端产物）不包含 Lab 代码、fixture 或开发路径。

本规范定义 Lab 的输入、行为、响应式容器、fixture 边界和 Product 排除门禁。

frontmatter 字段说明：`schema: nbook.spec/v1` 表示遵循 NeuroBook 规范格式 v1 版；`kind: behavior` 表示这是行为规范；`capability: ui.component-lab` 是本规范在项目中的唯一标识符；`status: planned` 表示规范已批准但尚未实现。


# NeuroBook Component Lab

## 目标与非目标

目标：

- 为开发者提供只存在于Source Dev环境的NeuroBook组件检视入口，用确定性fixture观察组件合同、交互状态和响应式边界。
- 让迁移中的demo场景拥有唯一、可复现的Lab destination，并与需要真实产品能力的正式界面场景分开。
- 保证Product客户端、Nitro图、路由和产物不包含Lab、fixture或开发路径信息。

非目标：

- Lab不是Product功能，不面向最终用户，也不是正式业务入口。
- Lab不读取真实API、Provider、Model、Project、Session、Pinia持久化或storage，不执行真实产品副作用。
- Lab不替代正式产品界面、Desktop smoke、主题首帧验证或`390×844`真实业务流程验收。
- 本规范不建立Workbench/View Host、插件运行时、第三方扩展API或新的Workflow产品页面。

## 术语与参与者

- **Source Dev**：从仓库源码启动的开发环境（通过 `bun run dev` 启动），可包含仅供开发验证的能力；通过环境变量 `process.env.NODE_ENV === 'development'` 和构建配置识别。
- **Product**：可分发的客户端、Desktop（Electron 桌面应用）或服务端产物；不得包含 Lab 代码和 fixture。Product 通过 `bun run build` 构建，输出 Nuxt 静态站点或 Nitro 服务端应用。
- **Lab**：Source Dev-only 的组件检视入口及其导航、查询、inspector（显示组件当前 props、events、状态的调试面板）和响应式容器。
- **fixture**：确定性（每次运行结果相同）、脱敏（不含真实用户数据）、无真实产品副作用的组件输入和交互场景。
- **scenario**：具有稳定 ID（如 `button-variants`、`dialog-confirm`）、明确输入和可观察结果的单个验收场景。
- **formal surface**：承载真实产品状态与副作用的正式产品界面（如设置页、会话列表、项目管理页）。
- **demo-only**：可由 deterministic fixture 完整表达的场景，迁移后进入 Lab。
- **product-behavior**：必须在正式产品界面并使用真实产品边界（如真实 API、Session、Project）验证的场景，不能用 fixture 替代。
- **catalog**：NeuroBook 产品组件的唯一索引（见 component-contracts.md），记录每个组件的 ID、状态（`pending`/`ready`）、owner（负责该组件的 UI 领域）和依赖。
- **pending**：catalog 条目尚无足够 fixture 或正式界面证据，不能在 Lab 中挂载为可交互场景。
- **ready**：catalog 条目的合同、fixture 和验证已闭合（证据已提交并通过），可在 Lab 中加载。
- **destination**：场景迁移后的归属位置。`demo-only` 的 destination 是 Lab 中的唯一 fixture；`product-behavior` 的 destination 是正式产品界面（如某个页面的特定交互路径）。
- **Project**：NeuroBook 中的项目单元，包含多个文件、配置和会话。
- **Session**：一次对话会话，包含消息历史、上下文和关联的 Project。
- **Provider/Model**：大模型服务提供方（如 OpenAI、Anthropic）和具体模型（如 GPT-4、Claude）。
- **Pinia**：Vue 全局状态管理库，NeuroBook 用于管理应用状态。
- **storage**：浏览器本地存储（localStorage、IndexedDB）或文件系统持久化。
- **Nitro**：Nuxt 3 的服务端引擎和构建工具。「Nitro 图」指构建依赖图（modules、routes、assets 的引用关系）。
- **preview 源**：旧的组件演示页面文件（位于 `app/pages/preview/`），14 个文件共包含 31 个 scenario。
- **trigger**：触发场景的入口（如点击某个按钮、打开某个菜单）。「current trigger」指旧 preview 中触发该 scenario 的方式，迁移时需保留真实触发路径。
- **mock**：伪造的成功结果或替代实现。fixture 使用确定性输入，但不应伪造业务逻辑的成功（如假装 API 调用成功但实际未验证错误处理）。
- **group**：catalog 中的组件分组（如 `form`、`layout`、`data-display`），用于 Lab 导航。
- **owner**：负责该 catalog 条目的 UI 领域（如 owner A 负责基础表单控件，owner B 负责数据展示组件）。
- **Task**：开发任务单元（如 `t01-migration-design` 负责迁移设计，A Task 将负责首批组件实现），定义工作范围、验收标准和交付物。
- **闭合**：指证据已提交、验证已通过、相关 Task 已完成的状态。
- **Desktop smoke**：桌面应用的冒烟测试（快速验证核心功能可用的测试）。
- **主题首帧验证**：验证主题样式（颜色、字体）在首次渲染时正确加载，无闪烁（FOUC，Flash of Unstyled Content）。
- **Workbench**：NeuroBook 的工作台主界面框架，不在本规范范围内。
- **View Host**：NeuroBook 的视图容器框架，不在本规范范围内。
- **Workflow**：NeuroBook 的工作流产品页面，不在本规范范围内。
- **sentinel**：用于识别 Lab 存在的标记（如特定字符串、文件名、module ID），Product 构建必须排除。
- **registry**：组件索引的存储结构。catalog 是唯一 registry；「第二份 registry」指违反唯一性的重复索引，是禁止的。
- **系统临时根**：操作系统临时目录下的项目专用路径（通过 `@notnotype/neuro-book-test-support/paths` 的 `resolveAgentTempRoot()` 解析，如 Windows 下为 `C:\Users\<user>\AppData\Local\Temp\neuro-book\...`），验收生成的临时证据（截图、日志）写入此处，24 小时后自动回收。
- **Product 门禁**：在 Product 构建流程中运行的检查命令，验证构建产物、路由图、manifest 不包含 Lab、fixture、开发路径或 sentinel；门禁失败则拒绝发布。
- **fail closed**：失败时拒绝操作，不静默降级。当 fixture 尝试访问真实 API 时，应立即失败并报错，而不是静默替换为 mock 成功。
- **合同**：组件的行为规范，定义 props、emits、slots、键盘、ARIA、状态等（见 component-contracts.md 的「组件合同」定义）。
- **迁移**：将产品源码中的 232 个组件逐步迁移到 `@notnotype/nb-ui` 包的过程，分为 A–P 多个切片（每个切片由一个 owner 负责一组组件）。
- **demo 场景**：与 `demo-only` 同义，指可由确定性 fixture 完整表达的场景。

## 输入与前置条件

Lab 只接受 `ready` 组件 catalog 条目及其确定性 fixture。每个 fixture 必须声明以下内容：

- **稳定 scenario ID**：在迁移期间不变的场景标识符（如 `button-primary`、`dialog-confirm-delete`）。
- **所属组件**：fixture 验证的组件 ID。
- **输入数据**：props 初始值、slots 内容。
- **初始状态**：组件挂载时的状态（如 `loading: false`、`error: null`）。
- **允许动作**：用户可执行的操作（如点击按钮、输入文本）。
- **预期可观察结果**：执行动作后的状态变化或事件（如 `emit('submit')`、`loading: true`）。
- **响应式要求**：在 phone（`390×844`）、tablet（`768×1024`）、desktop 容器下的预期行为。

`pending` 条目可以被查询并显示阻塞原因，但不能挂载为可交互场景。fixture 不得要求凭据、网络、真实 Project/Session、Provider/Model 或持久化 store。

Lab 入口只在 Source Dev 条件满足时存在。Product 构建、预览（通过 `bun run preview` 预览构建产物）、安装包或运行时不得通过环境变量隐藏一个实际已打包的 Lab；排除必须发生在构建图和路由生成边界。

当前迁移基线包含 14 个 preview 源和 31 个稳定 scenario。scenario 的以下属性保持稳定：

- **ID**：如 `button-variants`、`dialog-confirm`。
- **page**：scenario 原属的 preview 页面（如 `preview/buttons`、`preview/dialogs`）。
- **kind**：`demo-only` 或 `product-behavior`。
- **粒度**：单组件 scenario 或多组件交互 scenario。

26 个 `demo-only` 最终需要唯一 Lab fixture；5 个 `product-behavior` 必须保留 current trigger 并迁往唯一 formal surface，不能降级为 mock Lab 证明（指用假数据伪造成功，但未验证真实业务逻辑）。

## 输出与可观察行为

- Source Dev 中的调用方可以按 group、组件和 scenario 定位唯一 Lab 场景，并查看状态、输入和阻塞信息。
- 选中 `ready` 场景后，Lab 使用确定性 fixture 渲染组件；重复打开得到相同初始状态，不依赖真实用户数据或网络时序。
- Lab 提供桌面、phone 和 tablet 响应式容器；phone 固定为 `390×844`，tablet 固定为 `768×1024`。容器切换不改变 fixture 语义。
- Lab 可以呈现组件事件、受控值（由父组件通过 props 传入的数据）和局部交互状态，但不得把宿主业务状态（如 Session 历史、Project 配置）伪装成组件内部 authority（指组件自身拥有的状态或数据源）。
- `demo-only` 场景迁移后具有一个唯一 Lab destination；`product-behavior` 只显示其正式 destination（指向正式产品界面的链接或路径描述）或未完成状态，不以 fixture 替代真实验收。
- Product 环境访问 Lab 路径得到正常的不存在结果（404），且客户端与 Nitro 构建图、文本和 manifest 中不包含 Lab 模块、fixture、绝对源码路径或识别 sentinel。

## 状态与转换

| 当前状态 | 事件 | 下一状态 | 可观察结果 |
|---|---|---|---|
| Source Dev 无选中项 | 选择 `pending` 条目 | 阻塞详情 | 显示阻塞原因，不挂载 fixture。 |
| Source Dev 无选中项 | 选择 `ready` 场景 | 场景已加载 | 按确定性输入呈现组件和 inspector。 |
| 场景已加载 | 执行允许动作 | 场景局部状态变化 | 事件和可观察状态按合同更新，不写真实产品数据。 |
| 场景已加载 | 切换 responsive 容器 | 同一场景已加载 | 保持 fixture 语义，以目标尺寸重新呈现。 |
| `demo-only` 未迁移 | 唯一 fixture 与证据闭合 | `demo-only` 已迁移 | 旧 preview 场景可指向唯一 Lab destination。 |
| `product-behavior` 未迁移 | 正式界面证据闭合 | formal surface 已迁移 | 保留真实触发与副作用证据，不创建替代 Lab fixture。 |
| Product 构建 | 解析路由和模块图 | Lab 不存在 | 无 Lab 路由、模块、fixture、路径或 sentinel。 |

## 副作用与数据

Lab 只读取版本控制内的 catalog 与 fixture，维护本地开发界面状态。它不写用户配置、Project Workspace（指 Project 的工作区状态，如打开的文件、编辑器布局）、Session 历史、业务数据库或浏览器持久化，也不访问真实网络服务。

fixture 必须使用脱敏的静态或内存数据。需要事件、时间或错误分支时使用确定性输入；不得调用真实 Provider/Model、真实 API 或依赖共享用户状态。

Product 排除是构建副作用边界：Source Dev 注册 Lab，Product 不注册也不打包 Lab。验收生成的临时证据（截图、日志）使用系统临时根，不进入仓库或 Product 产物。

## 失败与恢复

- fixture 缺失、scenario ID 重复、catalog 条目非 `ready` 或输入不确定时，拒绝挂载并显示明确阻塞原因。
- fixture 尝试访问真实 API、持久化状态、Provider/Model 或产品凭据时，fail closed 并把场景视为不合格，不静默替换为 mock 成功。
- Product 构建图、路由、文本或 manifest 出现 Lab、fixture、开发绝对路径或 sentinel 时，Product 门禁失败；不能用运行时 404 或 middleware 隐藏来判定通过。
- 响应式容器发生页面级横向溢出、操作遮挡或不可恢复焦点时，场景保持未验收，不降低 viewport 要求。
- Lab 失败不改变产品数据。恢复方式是修正同一 fixture 或合同后重新加载，不创建第二份 registry 或并行 Lab 入口。

## 边界与兼容

UI 模块（指 monorepo 内的 `@notnotype/nb-ui` 包及其相关代码）拥有 Lab、catalog 消费和 fixture 合同；各产品领域（指主应用 `packages/neuro-book` 内的业务代码）拥有 formal surface 及其 API、Project、Session、Pinia、storage 和副作用。

Lab 只能消费组件 catalog 的唯一聚合视图（由 aggregate 模块提供的合并后的 catalog，见 component-contracts.md），不能维护第二份组件或 scenario 清单。场景 ID 和 kind 在迁移期间保持稳定；变更需要重新审查目标合同，不能由后续实现 Task 自行重分类。

`demo-only` 与 `product-behavior` 边界是强约束。执行真实 Provider、Model、Session、Project 或业务写入的行为必须留在 formal surface；Lab 只承载 deterministic fixture。

旧 preview 路由（指 `app/pages/preview/` 下的页面路由）在所有组件和 31 个 scenario 均有合法唯一 destination、Product 排除及真实验收证据前保持存在。Lab 落地本身不授权删除 preview 路由。

## 验收与 Smoke


示例 catalog 条目（简化 JSON）：

```json
{
  "id": "button-001",
  "source": "nbook/app/components/Button.vue",
  "label": "Button",
  "group": "form",
  "parent": null,
  "tier": "presentational",
  "maturity": "stable",
  "status": "ready",
  "description": "Primary action button",
  "dependencies": { "external": "none" }
}
```

示例 fixture 声明（简化）：

```typescript
{
  scenarioId: 'button-primary',
  component: 'button-001',
  input: { label: 'Submit', variant: 'primary', disabled: false },
  initialState: { loading: false },
  actions: ['click'],
  expected: { emits: ['click'], state: { loading: false } },
  responsive: { phone: true, tablet: true, desktop: true }
}
```

示例 scenario ID 列表（部分）：

- `button-variants`（demo-only，展示 primary/secondary/danger 按钮）
- `dialog-confirm-delete`（product-behavior，真实删除 Project 确认对话框）
- `input-validation`（demo-only，表单校验状态）

1. Given Source Dev，When 打开 Lab 入口，Then 可以按唯一 catalog 定位条目；`pending` 只显示阻塞原因，`ready` 可加载确定性 fixture。
2. Given 同一 `ready` fixture，When 重复打开或重置，Then 初始输入和可观察状态一致，不依赖网络、真实用户数据或持久化 store。
3. Given phone 与 tablet 容器，When 分别切换到 `390×844` 和 `768×1024`，Then 场景语义不变，核心操作可完成，无页面级横向溢出或控件重叠。
4. Given fixture 执行允许动作，When 组件发出事件，Then inspector 可观察受控值和事件；真实 API、Project、Session、Provider/Model 和 storage 均无副作用。
5. Given 26 个 `demo-only` 迁移场景，When 对应 owner 闭合，Then 每个稳定 scenario ID 恰有一个 deterministic Lab destination 和证据。
6. Given 5 个 `product-behavior` 场景，When 查询迁移状态，Then 保留 current trigger 和 formal surface 证据，不以 Lab fixture 或 mock 结果宣称完成。
7. Given Product 客户端和 Nitro 构建，When 检查路由、模块图、文本和 manifest，Then 不存在 Lab 模块、fixture、开发绝对路径或 sentinel；访问 Lab 路径为不存在（404）。
8. Given 任一 Product 排除或场景唯一性检查失败，When 尝试清退旧 preview 路由，Then 清退被拒绝且旧入口保持可恢复。

## 证据

- 批准依据：开发者明确批准闭合 `t01-migration-design` 并创建本 `planned` Spec；未批准实现或创建 A 实现 Task（指将负责首批组件实现的任务）。
- 当前设计证据：[t01 迁移设计 Task](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t01-migration-design/README.md)。
- Preview 场景基线：[preview-scenario-baseline.json](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t01-migration-design/evidences/preview-scenario-baseline.json)（31 个 scenario 的 ID、kind、page、粒度）。
- 组件状态边界：[UI 组件合同](component-contracts.md)。
- 本 Spec 尚未实现；Source Dev Lab、fixture、Product 排除、浏览器和构建证据均不因 `planned` 状态而存在或通过。
