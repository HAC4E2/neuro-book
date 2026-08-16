# nb-ui 界面开发规范

状态：当前规范。适用于公共组件、主题、配色、样式基座与 playground。后续界面开发必须遵守；变更长期行为时先改本文，再改实现。

本文只规定工程合同。产品默认主题为什么这样设计，见 [设计语言](./design-language.md)；主题包格式、装载与市场边界，见 [主题作者规范](./authoring-themes.md)。

## 1. 事实源

| 事项 | 唯一事实源 |
| --- | --- |
| 配色变量名 | `src/colorway/colorway-contract.ts` 的 `nbColorwayVarKeys` |
| 设计与主题 token 名 | `src/theme/tokens.ts` |
| token 基线值 | `src/tokens.css` 的裸 `:root` |
| 公共控件与浮层外观 | `src/styles.css` |
| 组件导出 | `src/components/index.ts` |
| 主题可覆盖组件 | `src/theme/contracts.ts` |
| 组件交互合同 | 组件导出的 props/emits/types 与对应行为测试 |
| 组件调试登记 | `playground/app/component-lab/registry.ts` |

同一规则只在表中指定的位置维护。README 只描述公开用法，playground 只提供可运行证据。

## 2. 材料、颜色与层级

1. 内容面与器械面分开。稿面使用实心 paper 角色；工具栏、侧栏、控件和浮层使用 chrome 角色。玻璃效果不得进入长文内容面。
2. 组件不得写字面颜色。颜色来自配色变量；形状、密度、装饰和角色映射来自主题 token。纯黑或纯白的低透明度光照层仅可在主题包内使用。
3. 组件不得直接引用某套主题私有变量。公共组件只消费配色合同、`nbDesignTokens`、`nbThemeTokens` 或 manifest 声明且具备 fallback 的变量。
4. 只有 raised、popover、dialog 三档层级。阴影消费 `--elevation-*`；普通页面区块不以阴影代替结构。
5. 浮层使用 `.nb-ui-popover-surface`。菜单叠加 `.nb-ui-menu-surface`；大块玻璃面按设计语言要求显式叠加 `.nb-ui-surface-rim`。组件不得复制这些属性。
6. 新公共 token 至少有两个独立消费点或明确的跨组件角色。单组件差异留在组件内部，第三方主题专用差异走 manifest `declares`。

## 3. 几何与排版

1. 单行字段默认消费 `.nb-ui-control-h-md` 与 `.nb-ui-control-px`；紧凑档消费 `sm`，大档消费 `lg`。组件模板不得重新写固定高度模拟同一档。
2. 控件、面板、菜单、胶囊分别消费 `--radius-control`、`--radius-panel`、`--radius-menu`、`--radius-pill`。浮层内角由 `.nb-ui-popover-item` 推导，不独立写 `rounded-*`。
3. 界面文字消费 `--font-ui` 与登记字号；长文内容消费 `--font-display` 和阅读刻度。`--text-2xs` 只用于计数、序号、时间戳和短角标。
4. 布局使用明确的 grid/flex 轨道、gap、min/max 与 overflow 所有权。动态文字、图标、加载态和计数不得改变固定格式控件的外框尺寸。
5. 390px 宽度必须无页面级横向溢出。窄屏可以重排工具面板，但不得隐藏完成核心操作所需的控件。

## 4. 组件合同

每个公共组件必须有一份可从类型和测试读出的合同：

- props：受控值、禁用/只读/必填/无效状态、语义尺寸和必要 HTML 属性；
- emits：值变化、提交、焦点或关闭原因等消费方可观察事件；
- slots：只开放稳定的内容插槽，不把内部 DOM 层级变成合同；
- a11y：角色、名称、状态、关联描述、键盘和焦点归还；
- 边界：空值、未知值、禁用项、最小/最大值、溢出与窄屏行为。

NeuroBook 主仓存在同名组件时，阶段 2 的公开功能不得低于主仓版本。视觉结构可以重做；主仓依赖的 props、emits、slots 和行为必须迁入，无法迁入的差异要先形成决策。

原生 `button`、`input` 等已经提供完整交互时直接使用。复合控件、浮层、焦点圈、游标导航与选择状态优先使用 Reka UI。选用原语后仍由 nb-ui 固定公开合同，不能把 Reka 的全部 props 透传成无边界 API。

### 状态下限

所有可交互组件至少覆盖：默认、hover、focus-visible、active/selected、disabled。字段再覆盖 readonly、required、invalid、empty/placeholder；异步组件覆盖 loading、empty、error；浮层覆盖 open、close、outside interaction、Escape 与视口碰撞。

状态色使用 `--status-info/success/warning/danger` 三件套。危险操作不能只靠颜色表达；禁用状态保留可读名称和状态语义。

## 5. 表单与无障碍

1. 字段组件接入 `FormField` context：生成或接受 `id`，连接 `aria-describedby`，合并 `required`，错误时输出 `aria-invalid`。
2. 可见标签优先。图标按钮必须有非空 `aria-label`；tooltip 不能替代可访问名称。
3. 复合选择控件必须暴露正确角色和状态，并支持预期方向键、Home/End、Enter、Escape。关闭浮层后焦点回到触发器。
4. 只读不等于禁用：只读字段可聚焦、可复制，不提交值变化；禁用控件不响应指针或键盘，也不进入正常 Tab 顺序。
5. `prefers-reduced-motion` 与 `prefers-reduced-transparency` 的公共降级规则优先于主题。动效只解释出现、消失、位置或状态变化，不承担必要信息。

## 6. 组件调试工作台

`/lab` 是逐组件诊断面，`/components` 是全量组合画廊，`/workbench` 是产品设计语言切片。三个页面职责不得合并。

### 登记合同

新增或修改公共组件时，必须在 `playground/app/component-lab/registry.ts` 登记：

- 稳定组件 id、名称与分组；
- 至少一个默认场景和一个边界/状态场景；
- 场景需要暴露的 props 控件；
- 预览中用于计算样式和结构检查的真实目标元素；
- 用户可观察事件。

工作台首批登记 `FormInput`、`FormNumberInput`、`FormSelect`、`FormCheckbox`。后续批次在同一注册表扩展，不能另建组件专属调试页。

### 状态所有权

| 状态 | 所有者 |
| --- | --- |
| 当前组件、场景、预览宽度 | URL query，可复制和恢复 |
| 当前主题与配色 | 现有 `useTheme` / `useColorway` store，并镜像到 URL |
| 场景 props 与组件值 | 页面会话；切换场景时恢复场景默认值 |
| CSS 变量覆盖 | `localStorage` 草稿 + 仅 `/lab` 存活的覆盖层 |
| 事件日志与结构检查结果 | 页面内存，不持久化 |

变量编辑器从三张登记表读取变量：`nbColorwayVarKeys`、`nbDesignTokens`、`nbThemeTokens`，再合并已安装主题 manifest 的 `declares`。离开 `/lab` 必须移除覆盖层；重新进入时可恢复本地草稿。覆盖层不得调用主题/配色 store 改写源数据。

导入导出格式固定为：

```json
{
  "schema": "nb-ui-component-lab-overrides",
  "version": 1,
  "overrides": {"--radius-control": "8px"}
}
```

导入只接受已登记变量、字符串值和版本 1。值禁止包含声明分隔符或规则边界，单值最长 512 字符；任一项无效时整份拒绝，不做半导入。

### 诊断输出

工作台必须同时提供：

- 场景 props 控制与真实 emits 日志；
- responsive、390px、768px 三档预览宽度；
- CSS 变量搜索、当前计算值、覆盖值、单项/全部重置、JSON 导入导出；
- 目标元素的尺寸、颜色、边框、圆角、阴影、排版与 ARIA 读数；
- 可访问名称、重复 id、invalid 语义、combobox 展开状态的结构检查。

这些读数用于定位，不替代浏览器验收。最终判据读取真实组件计算样式，并检查控制台和页面错误。

## 7. 测试与交付

行为测试只守可观察合同：值变化、边界、键盘、焦点、ARIA、打开后的 portal 内容、滚动和错误状态。不得以源代码字符串或无意义的 class 快照代替行为；外观来源和公共登记类可以用窄断言防止职责回流。

每批组件完成时：

1. 更新组件类型、所有本仓调用方和 barrel 导出；
2. 增加或更新覆盖新合同的 happy-dom 测试；
3. 更新 `/lab` 登记与 `/components` 组合画廊；
4. 同步 README 的公开用法；
5. 依次运行 `bun run test`、`bun run typecheck`、`bun run build:css`、`git diff --check`；
6. 在真实 playground 验收桌面和 390px 窄屏，记录主题 × 配色、计算样式、键盘路径、控制台与页面错误；
7. 提交 `dist/nb-ui.css`，并明确阶段 2 尚未经 NeuroBook 主仓接入验证。
