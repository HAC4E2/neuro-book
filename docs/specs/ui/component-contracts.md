---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: ui.component-contracts
owners:
  - ui
---

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

- **组件合同**：调用方与用户能够观察到的props、emits、slots、键盘、焦点、ARIA、状态、布局和错误行为。
- **catalog**：NeuroBook产品组件的唯一索引；每个产品组件只有一个条目和一个owner。
- **presentational**：只消费受控值和显示输入，不拥有产品数据或业务副作用的组件。
- **composite**：组合多个UI能力，可持有局部交互状态，但产品数据和外部副作用由宿主提供。
- **workspace**：编排Project、Session、API、Pinia、storage或持久化状态的产品界面。
- **pending**：尚无足够确定性fixture或正式界面证据，不能在Lab中宣称可验收。
- **ready**：合同、确定性fixture或正式界面证据以及所需验证已经闭合。
- **组件owner**：负责该catalog条目状态、合同证据和迁移关闭条件的唯一UI领域。

## 输入与前置条件

每个catalog条目必须提供稳定ID、产品内source标识、用户可读label、group、parent、tier、maturity、status、description、外部依赖分类和owner。`pending`条目必须提供具体阻塞原因；`ready`条目必须提供可定位的确定性fixture或正式产品界面证据。

组件合同必须明确其受控值、可选值、事件、slot、disabled/read-only/loading/error状态、键盘操作、焦点顺序、ARIA名称与关系，以及会影响布局的最小/最大尺寸和overflow规则。不适用的状态必须明确为不支持，不能由实现者猜测。

产品组件进入catalog前必须属于NeuroBook产品组件范围。页面、应用根、开发Lab自身以及越界或非组件文件不得登记。source标识必须可无损映射到一个产品组件，禁止basename猜测或多个物理文件共享同一source。

## 输出与可观察行为

- 调用方可以通过唯一catalog查询组件的分类、owner、依赖、状态和证据，不会从第二份registry得到冲突结果。
- `pending`条目不会被呈现为可交互Lab场景；调用方能够看到具体阻塞原因。
- `ready`条目具有稳定场景，用户可观察默认、交互、禁用、错误、键盘、焦点和响应式行为中适用的部分。
- 组件在桌面与`390×844`窄屏下保持核心操作可完成；标签、按钮、浮层和动态内容不得发生不可理解的重叠或页面级横向溢出。
- 会改变尺寸的状态不得导致未声明的布局位移；固定格式控件使用稳定尺寸约束。
- 迁移公共primitive时，全部消费者在同一迁移边界内切换到公开入口；同名本地实现不会作为alias、adapter或可选fallback继续存在。
- 产品专属composite和workspace组件可消费公共primitive，但其数据owner、权限、持久化和副作用仍留在产品宿主。

## 状态与转换

| 当前状态 | 事件 | 下一状态 | 可观察结果 |
|---|---|---|---|
| 未登记 | 产品组件进入受管范围 | `pending` | 创建唯一catalog条目并给出具体阻塞原因；不宣称可验收。 |
| `pending` | 合同、fixture或正式界面证据与所需验证闭合 | `ready` | 条目可由Lab或正式界面稳定访问，证据指向唯一场景。 |
| `pending` | source、owner或行为仍有歧义 | `pending` | 保持阻塞并报告歧义，不选择静默默认。 |
| `ready` | 行为合同发生变化 | `pending` | 旧证据失效，重新阻塞直至新合同与验证闭合。 |
| `ready` | 全部消费者迁移且旧入口删除条件满足 | `ready` | 唯一公开入口生效，旧实现和旧引用归零。 |
| 任意状态 | owner切片被移除或回滚 | 原状态或未登记 | 只回滚该owner的条目与证据，不生成第二catalog。 |

状态转换按条目串行评审。并行迁移不得由两个owner同时修改同一条目；发生冲突时保持原状态并停止关闭。

## 副作用与数据

catalog与合同是版本控制内的静态产品元数据，不写用户数据、不访问网络、不启动外部进程，也不取得Project、Session、API、Pinia或storage所有权。

组件fixture只能使用确定性、脱敏且有边界的数据。组件自身的外部副作用必须通过受控事件或宿主提供的端口表达；catalog状态不能触发产品写入。

删除旧入口是迁移副作用：只有所有静态、动态和测试消费者都已切换并满足对应合同后才执行。删除不得由运行时alias、双队列、双registry或静默fallback替代。

## 失败与恢复

- source无法唯一映射、parent缺失或形成环、ID重复、owner重复、依赖分类缺失时，catalog验证失败并拒绝状态晋升。
- `pending`缺少阻塞原因或`ready`缺少证据时，保持或恢复为`pending`。
- 组件行为、可访问性、响应式或正式界面证据与合同冲突时，迁移停止；修正实现或经批准更新同一Spec后重新验证。
- 公共UI入口不能覆盖现有产品行为时，不得用alias、adapter、双入口或静默fallback掩盖；应保持旧入口并报告公共合同缺口。
- 任一迁移切片可通过恢复该切片之前的唯一catalog状态和入口回滚，不影响其它owner已验证条目。

## 边界与兼容

UI模块拥有组件合同和catalog；产品领域继续拥有API、Project、Session、Pinia、storage、权限和持久化语义。公共组件包只拥有可复用UI primitive及其公开行为。

catalog的组件source采用稳定产品标识，不暴露机器绝对路径。每个条目只存在于一个owner集合；聚合视图只能组合并校验条目，不能复制形成第二真相源。

迁移必须使用公共包正式exports；禁止深层私有import。名称相同不等于合同兼容，切换前必须核对props、emits、slots、键盘、ARIA、SSR、CSS和浮层行为。

本规范不改变现有主题合同。主题能力发生迁移时必须更新`theme.system`同一Spec，不能在组件catalog内建立第二颜色authority。

## 验收与 Smoke

1. Given当前NeuroBook产品组件集合，When读取catalog，Then每个受管组件恰有一个条目，source可双向定位，无重复、遗漏、越界、缺失parent或环。
2. Given任一`pending`条目，When调用方读取状态，Then存在具体阻塞原因，且该条目不会被宣称为可交互Lab场景。
3. Given任一`ready`条目，When打开其确定性fixture或正式界面，Then默认、交互、禁用、错误、键盘、焦点和响应式合同中适用的部分均可观察且与合同一致。
4. Given桌面与`390×844`视口，When完成组件核心操作，Then无页面级横向溢出、不可理解重叠或动态内容引起的未声明布局位移。
5. Given组件依赖API、Pinia或storage，When审查catalog和fixture，Then依赖被显式分类，fixture不取得真实产品数据owner。
6. Given公共primitive迁移，When所有静态、动态和测试消费者完成切换，Then旧入口、旧样式和旧引用归零；任一消费者未切换时删除门禁失败。
7. Given合同或source集合发生变化，When旧证据不再覆盖当前行为，Then对应条目回到`pending`并报告原因，不静默沿用旧证据。

## 证据

- 批准依据：开发者明确批准闭合`t01-migration-design`并创建本`planned` Spec；未批准实现。
- 当前设计证据：[t01迁移设计Task](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t01-migration-design/README.md)。
- 组件基线：[component-baseline.json](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t01-migration-design/evidences/component-baseline.json)。
- 调用方与删除门禁：[surface-caller-migration-map.json](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t01-migration-design/evidences/surface-caller-migration-map.json)。
- 本Spec尚未实现；产品源码、依赖、catalog、fixture和浏览器验收不因`planned`状态而成立。
