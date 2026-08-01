# PLAN：Profile 详情空白（dev-only）与配置中心尺寸调档

> 建立于 2026-08-01。触发来源：用户浏览器验收 Task 134 时发现两个问题——① 左侧二级列表点任意 Profile 后右侧永久空白（切回「默认设置」同样空白，控制台无报错）；② 配置中心 Dialog 偏小，要调大一档。
>
> **结论先行：空白不是数据/加载问题，是 `<Transition mode="out-in">` 被卡死。** `AgentProfileDefaultsPanel.vue` 的模板根注释让它在 dev 下编译成 Fragment 根，Vue 卸载这种组件时不会调用 `afterLeave`，Transition 从此永远停在 `isLeaving = true`，只渲染空占位注释。**只在 dev 复现，生产构建（注释被剥离）无此问题**，所以它不是发布阻塞项，但 dev 是日常开发与本地自用的主界面，必须修。

## 根因

### 证据 1：两个子组件的编译根节点不对称

用 `@vue/compiler-sfc` 按 dev 参数（`comments: true`）编译真实模板：

| 组件 | 根节点 | patchFlag |
| --- | --- | --- |
| `AgentProfileDefaultsPanel.vue` | `Fragment` | `2112` = `STABLE_FRAGMENT \| DEV_ROOT_FRAGMENT` |
| `AgentProfileDetailPanel.vue` | `<section>` 单元素 | — |

唯一差别：`AgentProfileDefaultsPanel.vue:41` 把 `<!-- 默认设置页：… -->` 写在了根 `<div>` **外面**，而 `AgentProfileDetailPanel.vue` 的 `<template>` 后紧跟 `<section>`。dev 编译保留注释 → 根变成「注释 + 元素」两个节点 → Fragment。

### 证据 2：Vue 3.5.39 + jsdom 实跑复现

手写与编译器等价的 render 函数，三组对照：

```
[A 离场方 = Fragment 根]      切换后: <!---->                  ❌ 空白（卡死）
[B 离场方 = 单元素根]         切换后: <div class="defaults">…   ✅ 正常
[C 两侧都是单元素根]          切换后: <section class="detail">… ✅ 正常
```

A 与线上现象一致：首屏（无 leave）正常，第一次切换后永久空白。

### 证据 3：runtime 代码路径

对着 `node_modules/@vue/runtime-core` 逐步走：

1. `BaseTransition` 新建 `leavingHooks`（**只有它挂了 `afterLeave`**），经 `setTransitionHooks` 写到离场组件 vnode 和它的 `subTree`。`subTree` 是 Fragment，**递归到此为止，不下沉到 Fragment 里的 `<div>`**。
2. `remove()` 对 dev root fragment 走特判：逐个删子节点，对元素子节点调 `remove(child)`。
3. 该元素身上的 `transition` 仍是**挂载时那份 enterHooks**，没有 `afterLeave`。
4. `performRemove` 里 `transition.afterLeave` 为 `undefined` → `state.isLeaving` 永不复位 → 之后每次渲染都返回 `emptyPlaceholder`。**这就是「切回默认设置也空白」的原因。**

### 为什么自审轮和 typecheck 都没拦住

- **静默**：Vue 的 `Component inside <Transition> renders non-element root node` 警告是在 `getChildRoot()` 把 root 重指到元素**之后**才判断的，所以这条警告根本不触发。控制台干净符合预期，不是用户漏看。
- **dev-only**：生产构建剥注释，根回到单元素，行为正常。
- **参照实现躲过去了**：全仓 `mode="out-in"` 只有 3 处，另外两处的子节点都是元素——`NovelIdeSettingsDialog.vue:840` 每个分支是包装 `<div>`，`NovelIdeModelSettingsPanel.vue:496`（本任务 D2 抄的那个）两个分支是内联 `<section>`。Task 134 把详情/默认页抽成子组件时，把「Transition 的孩子是元素」这个从未写下来的前提弄丢了。
- **测试面覆盖不到**：`vitest.config.ts` 是 `environment: "node"`，settings 目录下 8 个测试文件全是纯逻辑投影，不挂载 `.vue`。这类结构性回归目前没有任何自动化能拦。

### 影响面

| 位置 | 子节点形态 | 状态 |
| --- | --- | --- |
| `NovelIdeSettingsDialog.vue:840` | 包装 `<div>` × 9 | 安全 |
| `NovelIdeModelSettingsPanel.vue:496` | 内联 `<section>` × 2 | 安全 |
| `NovelIdeAgentProfileModelSettingsPanel.vue:637` | **子组件**，其一为 Fragment 根 | **坏** |

另有两个组件也是 Fragment 根（`AgentProfileNavList.vue:59`、`NovelIdeAgentProfileModelSettingsPanel.vue:591` 的根注释），但它们不是任何 `Transition` 的直接子节点，当前无害；只是同类地雷。默认 mode 的 `Transition` 不受影响（不依赖 `afterLeave`），只有 `out-in` / `in-out` 会中招。

---

## A. 修复空白（两步一起做）

### A1 消掉 Fragment 根

`app/components/novel-ide/settings/AgentProfileDefaultsPanel.vue:41`：把根注释移进根 `<div>` 内部。1 行改动。

顺带修掉 Fragment 根的另一个隐性问题：这种组件收不到 fallthrough attrs / class。

### A2 让 Transition 的子节点恒为元素

`app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue:637`，把两个分支包进带 key 的 `<div>`：

```html
<Transition name="fade-slide" mode="out-in">
    <!-- 直接子节点必须是元素：子组件若编译成 Fragment 根（模板根注释就会），out-in 的 leave 拿不到 afterLeave，会永久卡在 isLeaving -->
    <div v-if="activeProfile" :key="activeProfile.profileKey">
        <AgentProfileDetailPanel :key="activeProfile.profileKey" ... />
    </div>
    <div v-else key="defaults">
        <AgentProfileDefaultsPanel ... />
    </div>
</Transition>
```

写法直接沿用同一个 Dialog 里 `NovelIdeSettingsDialog.vue` 已经验证过的形态，不发明新东西。

**为什么 A1 不够、必须加 A2**：AGENTS.md 自己的 HTML 规范就是「HTML 容器附近使用注释标注」——下一个人（或下一个 Agent）在根元素上方补一行注释就原地复发，而且照样不报错、照样只在 dev 复发。A2 之后子组件根是什么形状都无所谓，这才满足「在代码设计上约束以后不会犯这种错误」。A2 是纯模板包装：不新增组件、不动任何 script 逻辑、不改 props/emits。

**两处需要在实现时确认**：

1. **D5 契约（切 profile 重建详情组件、按覆盖数重判折叠初始态）**：外层 `:key` 变化会整棵子树重建，内层 key 保留只是把意图写明。改完要在走查里确认「有覆盖的 profile 打开时运行策略段自动展开」仍成立。
2. **vue-tsc narrowing**：`v-if="activeProfile"` 从组件移到包装 `<div>`，生成的虚拟代码仍是嵌套 `if` 块，narrowing 预期不变。若 `bun run typecheck` 报 `activeProfile` 可能为 null，退回只做 A1，并改为加一个编译期守卫测试（编译这两个 SFC，断言不含 `DEV_ROOT_FRAGMENT`）来锁住不变量。

不做：改 `mode="out-in"` 为默认 mode。默认 mode 下新旧两块会同时在流里，右栏没有绝对定位，会跳版。

---

## B. 配置中心 Dialog 调大一档

`app/components/novel-ide/NovelIdeSettingsDialog.vue:722-723`：

| 项 | 现在 | 改为 |
| --- | --- | --- |
| `width` | `1280px` | `min(1440px, calc(100vw - 48px))` |
| `height` | `86vh` | `90vh` |

宽度顺带补上现在缺的小屏保护：当前是裸 `1280px`，窗口窄于 1280 时弹窗直接顶出屏幕。Dialog 的 `size` 预设用不上（`xl` 只有 1080px 更小，`full` 是满屏太大），继续走显式 `width` / `height`。

**连带必改**：`app/components/novel-ide/settings/AgentProfileNavList.vue:94` 的 `max-h-[calc(86vh-330px)]` 是照着弹窗高度硬算的魔数（公式 = 弹窗高度 − 330px，330 ≈ header + 配置目标栏 + 搜索框 + 默认设置入口 + 分组标题），必须同步改成 `calc(90vh-330px)`，并在旁边加注释标明这个跨文件耦合，否则二级列表滚动区会和弹窗高度脱节。

`xl:grid-cols-[240px_minmax(0,1fr)]` 是视口断点不是容器断点，弹窗变宽不影响它，不动。

**待拍板**：1440px / 90vh 是我按「一档」给的默认值。若想只加宽不加高、或直接上接近满屏，说一个数就行，改动量不变。

---

## 执行顺序

**第一批（不可拆）**：A1 + A2 + B。三处都是模板层改动，A 与 B 还共享同一批浏览器走查动作，分批只会让走查做两遍。

**不在本轮**：README「已知但未处理」记的 `refreshBuildStatus` 编译结束回调 `loadSettings()` 冲掉草稿——独立议题，与本次结构性问题无关，继续挂在 README。

## 验证

自动：

- `bun run typecheck`：确认 `app/components/novel-ide/settings/**` 与 `NovelIdeSettingsDialog.vue` 零错误（重点看 A2 的 narrowing）。
- `bunx vitest run app/components/novel-ide/settings`：现有 8 文件 40 用例应保持全绿。本次只动模板，预期零变化；**若有用例挂，说明改动越界了**。
- 两条命令分开跑，不并发（并发会让 nuxt 重写 `.nuxt/tsconfig` 产生假失败，Task 134 首轮撞过）。

浏览器走查（用户执行，dev server 需重启）：

1. 点任意 Profile → 右侧出现该 Profile 详情（本次核心）。
2. 再点「默认设置」→ 正常回到默认页（验证 `isLeaving` 不再卡）。
3. 连续切换两个不同 Profile → 都能渲染，且有覆盖的 Profile 打开时「运行策略覆盖」段自动展开、无覆盖的保持折叠（D5 未被 A2 破坏）。
4. 弹窗尺寸观感是否到位；二级列表在新高度下滚动区正常、`sticky` 仍常驻。
5. 把浏览器窗口拖窄到 1280px 以下，弹窗不应溢出屏幕。
6. Task 134 README 里原有的走查清单（搜索过滤、未保存圆点、保存后圆点消失、Project scope 重置 Home 禁用态、运行策略三组标题顺序）顺带一起过。

## 文档回写

- `docs/tasks/134-agent-profile-settings-navigation/README.md`：
  - 「自审轮」补第 6 项——**抽组件改变了 Transition 子节点类型**。首轮自审逐行比对了数据流、保存形态键顺序和文案，但没检查「原来的 Transition 子节点是内联元素，抽成组件后变成组件」这个结构性前提，属于自审维度缺失，要写明教训。
  - 「Verification / Test」补一条：node 环境的 vitest 不挂载 `.vue`，这类结构性回归**没有任何自动化能拦**，只能靠走查。
  - TODO 里的浏览器走查清单加入上面 1–5 条。
- `PROJECT-STATUS.md`：不动。本轮是既有任务的 UI 修复，不改架构决策、模块状态或长期 TODO，按文档规范不触发仓库级同步。

## 临时文件

诊断脚本在 `.agent/workspace/task134-probe/`：`compile-check.ts`（编译根节点探针）、`transition-repro.ts`（jsdom 复现）。实现收口时删除；用户若要自查可先跑 `bun .agent/workspace/task134-probe/transition-repro.ts`。
