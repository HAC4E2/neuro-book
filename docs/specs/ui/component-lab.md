---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: ui.component-lab
owners:
  - ui
---

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

- **Source Dev**：从仓库源码启动的开发环境，可包含仅供开发验证的能力。
- **Product**：可分发的客户端、Desktop或服务端产物；不得包含Lab代码和fixture。
- **Lab**：Source Dev-only的组件检视入口及其导航、查询、inspector和响应式容器。
- **fixture**：确定性、脱敏、无真实产品副作用的组件输入和交互场景。
- **scenario**：具有稳定ID、明确输入和可观察结果的单个验收场景。
- **formal surface**：承载真实产品状态与副作用的正式产品界面。
- **demo-only**：可由deterministic fixture完整表达的场景。
- **product-behavior**：必须在正式产品界面并使用真实产品边界验证的场景。

## 输入与前置条件

Lab只接受`ready`组件catalog条目及其确定性fixture。每个fixture必须声明稳定scenario ID、所属组件、输入数据、初始状态、允许动作、预期可观察结果和响应式要求。

`pending`条目可以被查询并显示阻塞原因，但不能挂载为可交互场景。fixture不得要求凭据、网络、真实Project/Session、Provider/Model或持久化store。

Lab入口只在Source Dev条件满足时存在。Product构建、预览、安装包或运行时不得通过环境变量隐藏一个实际已打包的Lab；排除必须发生在构建图和路由生成边界。

当前迁移基线包含14个preview源和31个稳定scenario。scenario ID、page、kind和粒度保持稳定：26个`demo-only`最终需要唯一Lab fixture；5个`product-behavior`必须保留current trigger并迁往唯一formal surface，不能降级为mock Lab证明。

## 输出与可观察行为

- Source Dev中的调用方可以按group、组件和scenario定位唯一Lab场景，并查看状态、输入和阻塞信息。
- 选中`ready`场景后，Lab使用确定性fixture渲染组件；重复打开得到相同初始状态，不依赖真实用户数据或网络时序。
- Lab提供桌面、phone和tablet响应式容器；phone固定为`390×844`，tablet固定为`768×1024`。容器切换不改变fixture语义。
- Lab可以呈现组件事件、受控值和局部交互状态，但不得把宿主业务状态伪装成组件内部authority。
- `demo-only`场景迁移后具有一个唯一Lab destination；`product-behavior`只显示其正式destination或未完成状态，不以fixture替代真实验收。
- Product环境访问Lab路径得到正常的不存在结果，且客户端与Nitro构建图、文本和manifest中不包含Lab模块、fixture、绝对源码路径或识别sentinel。

## 状态与转换

| 当前状态 | 事件 | 下一状态 | 可观察结果 |
|---|---|---|---|
| Source Dev无选中项 | 选择`pending`条目 | 阻塞详情 | 显示阻塞原因，不挂载fixture。 |
| Source Dev无选中项 | 选择`ready`场景 | 场景已加载 | 按确定性输入呈现组件和inspector。 |
| 场景已加载 | 执行允许动作 | 场景局部状态变化 | 事件和可观察状态按合同更新，不写真实产品数据。 |
| 场景已加载 | 切换responsive容器 | 同一场景已加载 | 保持fixture语义，以目标尺寸重新呈现。 |
| `demo-only`未迁移 | 唯一fixture与证据闭合 | `demo-only`已迁移 | 旧preview场景可指向唯一Lab destination。 |
| `product-behavior`未迁移 | 正式界面证据闭合 | formal surface已迁移 | 保留真实触发与副作用证据，不创建替代Lab fixture。 |
| Product构建 | 解析路由和模块图 | Lab不存在 | 无Lab路由、模块、fixture、路径或sentinel。 |

Lab交互状态只在当前开发会话和当前fixture内有效；切换scenario可恢复其确定性初始状态。本能力不引入持久状态。

## 副作用与数据

Lab只读取版本控制内的catalog与fixture，维护本地开发界面状态。它不写用户配置、Project Workspace、Session历史、业务数据库或浏览器持久化，也不访问真实网络服务。

fixture必须使用脱敏的静态或内存数据。需要事件、时间或错误分支时使用确定性输入；不得调用真实Provider/Model、真实API或依赖共享用户状态。

Product排除是构建副作用边界：Source Dev注册Lab，Product不注册也不打包Lab。验收生成的临时证据使用系统临时根，不进入仓库或Product产物。

## 失败与恢复

- fixture缺失、scenario ID重复、catalog条目非`ready`或输入不确定时，拒绝挂载并显示明确阻塞原因。
- fixture尝试访问真实API、持久化状态、Provider/Model或产品凭据时，fail closed并把场景视为不合格，不静默替换为mock成功。
- Product构建图、路由、文本或manifest出现Lab、fixture、开发绝对路径或sentinel时，Product门禁失败；不能用运行时404或middleware隐藏来判定通过。
- 响应式容器发生页面级横向溢出、操作遮挡或不可恢复焦点时，场景保持未验收，不降低viewport要求。
- Lab失败不改变产品数据。恢复方式是修正同一fixture或合同后重新加载，不创建第二份registry或并行Lab入口。

## 边界与兼容

UI模块拥有Lab、catalog消费和fixture合同；各产品领域拥有formal surface及其API、Project、Session、Pinia、storage和副作用。

Lab只能消费组件catalog的唯一聚合视图，不能维护第二份组件或scenario清单。场景ID和kind在迁移期间保持稳定；变更需要重新审查目标合同，不能由后续实现Task自行重分类。

`demo-only`与`product-behavior`边界是强约束。执行真实Provider、Model、Session、Project或业务写入的行为必须留在formal surface；Lab只承载deterministic fixture。

旧preview路由在所有组件和31个scenario均有合法唯一destination、Product排除及真实验收证据前保持存在。Lab落地本身不授权删除preview路由。

## 验收与 Smoke

1. Given Source Dev，When打开Lab入口，Then可以按唯一catalog定位条目；`pending`只显示阻塞原因，`ready`可加载确定性fixture。
2. Given同一`ready`fixture，When重复打开或重置，Then初始输入和可观察状态一致，不依赖网络、真实用户数据或持久化store。
3. Givenphone与tablet容器，When分别切换到`390×844`和`768×1024`，Then场景语义不变，核心操作可完成，无页面级横向溢出或控件重叠。
4. Given fixture执行允许动作，When组件发出事件，Theninspector可观察受控值和事件；真实API、Project、Session、Provider/Model和storage均无副作用。
5. Given 26个`demo-only`迁移场景，When对应owner闭合，Then每个稳定scenario ID恰有一个deterministic Lab destination和证据。
6. Given 5个`product-behavior`场景，When查询迁移状态，Then保留current trigger和formal surface证据，不以Lab fixture或mock结果宣称完成。
7. Given Product客户端和Nitro构建，When检查路由、模块图、文本和manifest，Then不存在Lab模块、fixture、开发绝对路径或sentinel；访问Lab路径为不存在。
8. Given任一Product排除或场景唯一性检查失败，When尝试清退旧preview路由，Then清退被拒绝且旧入口保持可恢复。

## 证据

- 批准依据：开发者明确批准闭合`t01-migration-design`并创建本`planned` Spec；未批准实现或创建A Task。
- 当前设计证据：[t01迁移设计Task](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t01-migration-design/README.md)。
- Preview场景基线：[preview-scenario-baseline.json](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t01-migration-design/evidences/preview-scenario-baseline.json)。
- 组件状态边界：[UI组件合同](component-contracts.md)。
- 本Spec尚未实现；Source Dev Lab、fixture、Product排除、浏览器和构建证据均未因`planned`状态而成立。
