# Agent 上下文构成

## 基本概念

- memory / checkpoint：持久化消息树，允许 fork，用于恢复线程历史。
- history message：当前活动分支加载出的 `BaseMessage[]`。
- prompt message：本轮真正发送给模型的 `BaseMessage[]`。
- persisted message：`profile.prepare()` 要求 run 开始前写入产品历史的消息。
- scope：本轮 run 开始时的变量快照，不是响应式对象。

`SimpleProfile.prepare()` 会读取 history 和 scope，调用 profile 的 TSX `buildPrompt(ctx)`，再把 `<ProfilePrompt>` 树拆成模型上下文、历史写入请求和线程 metadata 更新。

## Prepare 生命周期

`SimpleProfile.prepare(runtime)` 的核心顺序：

1. `runtime.loadHistoryMessages()` 加载当前活动分支历史。
2. continue 模式下，如果历史尾部是 `HumanMessage`，临时取出作为 `currentUserInputMessage`。
3. 构造 `ProfilePromptContext`，其中 `ctx.history` 不包含被取出的当前用户输入。
4. 执行 `buildPrompt(ctx)`，要求返回 `<ProfilePrompt>` 根节点。
5. 收集 `HistorySet`、dynamic 区域和 `AppendingSet`。
6. 渲染出 `modelMessages`、`persistedMessages`、`immediateMetadata` 和 `completedMetadata`。

`ThreadRunCoordinator` 随后会先提交这些 prepare 产物，再调用模型：

- `persistedMessages.prepend` 写入历史根部。
- `persistedMessages.append` 写入当前光标；如果带 `appendBeforeMessageId`，则插入到该消息之前。
- `immediateMetadata` 在模型调用前写入 thread metadata。
- `completedMetadata` 预留给 run completed 后写入；当前 `SimpleProfile` 的 `Reminder` / `Watch` 状态都走 `immediateMetadata`。
- `modelMessages` 是本轮真正发给模型的消息数组。

## ProfilePrompt 拆分规则

当前 `SimpleProfile` 要求 profile 返回：

```tsx
<ProfilePrompt>
    <HistorySet>...</HistorySet>
    <DynamicSet>...</DynamicSet>
    <AppendingSet>...</AppendingSet>
</ProfilePrompt>
```

顶层推荐显式写出三类 set，但实际收集规则更细：

- 最多只能有一个 `HistorySet`。
- 所有 `AppendingSet` 会合并成一个最新上下文区域，统一放到模型消息末尾附近。
- `DynamicSet` 和顶层裸 `<Message>` 等普通节点会按声明位置归入 dynamic 区域。
- 出现在 `HistorySet` 之前的 dynamic 节点进入 `preHistoryMessages`。
- 出现在 `HistorySet` 之后的 dynamic 节点进入 `postHistoryMessages`。
- 如果没有 `HistorySet`，所有 dynamic 节点都归入 `postHistoryMessages`。

因此完整模型消息顺序是：

```text
preHistoryMessages
-> historyMessages
-> postHistoryMessages
-> appendingMessages
-> currentUserInputMessage（仅 continue 且历史尾部是 HumanMessage）
```

大多数 profile 按推荐结构书写时，可以简化理解为：

```text
HistorySet/history -> DynamicSet -> AppendingSet -> CurrentUserInput
```

但如果在 `HistorySet` 前放了裸顶层节点，它会真的排在历史之前。

## HistorySet

`HistorySet` 用于长期稳定上下文，典型内容包括 profile 身份、长期工具原则、稳定写作约束和需要首轮持久化的 skill catalog。

关键规则：

- `HistorySet` 会被渲染成候选稳定前缀。
- 如果加载出的 history 第一条已经是 `SystemMessage`，本轮不会再使用 `HistorySet` 渲染结果，也不会补齐其中缺失的片段。
- 如果 history 第一条不是 `SystemMessage`，`HistorySet` 渲染结果会同时进入 `modelMessages` 和 `persistedMessages.prepend`。
- `SkillCatalog` 返回 string，必须包在 `<Message>` 内；需要首轮持久化时通常写成 `<Message role="system"><SkillCatalog text={ctx.skillCatalogText} /></Message>`。
- 不要把 `Watch` / `Reminder` 放进 `HistorySet`。

这意味着 `HistorySet` 是“首次注入稳定前缀”，不是每轮重新生成的 system prompt patch 机制。

## Dynamic 区域

Dynamic 区域用于本轮临时上下文，只进入 `modelMessages`，不会写入历史。

允许内容通常是普通 `<Message>`、`<History>`、`<If>` / fragment 展开的普通消息。适合放当前线程摘要、只对本轮有意义的状态、临时工具说明等。

不要放：

- `Reminder`：它需要 AppendingSet 的注入频率和历史写入逻辑。
- `Watch`：它需要 AppendingSet 的变量 baseline 与生成消息写入逻辑。
- 裸文本：非空文本必须放在 `<Message>` 内。

`SkillCatalog` / `ActivatedSkills` 本身只是 string 片段，也必须放进 `<Message>` 内。需要持久化的 catalog 放 `HistorySet`；显式激活 skill 内容通常放 `AppendingSet`。

## AppendingSet

`AppendingSet` 是贴近当前输入的最新上下文区域。它产出的非空消息会进入 `modelMessages`，并写入 `persistedMessages.append`。

推荐顺序：

```tsx
<AppendingSet>
    <Reminder id="leader-runtime">
        <Message role="human">当前剧情焦点、subagent、任务状态</Message>
    </Reminder>
    <Reminder id="workspace" watchPath="scope.studio.workspace" repeatEveryTurns={5}>
        <Message role="system">当前 workspace</Message>
    </Reminder>
    <Reminder id="plan-mode">
        <Message role="system">本轮 Plan Mode reminder</Message>
    </Reminder>
    <Watch ... />
    {activatedSkillsText ? <Message role="human"><ActivatedSkills text={activatedSkillsText} /></Message> : null}
    {shouldAppendInput ? <Message role="human" source="input">{promptText}</Message> : null}
</AppendingSet>
```

节点语义：

- `Reminder`：根据 `when`、`watchPath` / `watchValue`、`repeatEveryTurns` 判断是否注入。注入后会更新 `thread.metadata.reminders`。
- `Watch`：比较当前 scope 与 `thread.metadata.watchedVariables` baseline；变化时生成系统消息，并更新 watched baseline。
- `ActivatedSkills`：用户本轮显式输入 `$skill-name` 时，系统预加载对应 `SKILL.md` 后返回的文本片段。
- `<Message source="input">`：直接 prompt 模式下的真实用户输入，会写入历史；continue 模式下会跳过，避免重复写入。

`AppendingSet` 不接受非空裸文本；文本必须放在 `<Message>` 内。

## Continue 模式

leader UI 主路径会先把本轮用户输入写入 history，再以 `mode: "continue"` 触发 run。

`SimpleProfile` 对 continue 模式的处理：

- 只有当 `runtime.input.mode === "continue"` 且加载历史尾部是 `HumanMessage` 时，才把尾部消息视为 `currentUserInputMessage`。
- 该消息会从 `ctx.history` 和普通 history 区域中临时移除。
- `AppendingSet` 渲染出的运行期上下文排在它之前。
- `currentUserInputMessage` 最后追加回 `modelMessages`，保证模型看到的最后一条仍是用户输入。
- `persistedMessages.appendBeforeMessageId` 会优先使用 run option 的 anchor，其次使用尾部用户消息的 `messageId`，让 AppendingSet 历史消息插入到当前用户输入之前。
- continue 模式下，`<Message source="input">` 不会追加或持久化；显式 skill 激活会从当前用户输入文本中提取 `$skill`。

continue 模式真实顺序：

```text
HistoryWithoutCurrentUserInput
-> DynamicSet
-> AppendingSet
-> CurrentUserInput
```

如果 continue 模式下历史尾部不是用户消息，运行时不会伪造当前输入，顺序退化为普通 history + dynamic + appending。

## Watch 语义

`Watch` 在 `prepare()` 阶段执行，不是响应式订阅。

```tsx
<Watch
    path="scope.studio.workspace"
    render={({previousValue, currentValue}) => {
        if (!currentValue) {
            return null;
        }
        return (
            <Message role="system">
                {`当前小说 workspace 已设置为：${currentValue}`}
            </Message>
        );
    }}
/>
```

规则：

- `path` 必须以 `scope.` 开头。
- 当前值会写入 `thread.metadata.watchedVariables[path]`。
- fingerprint 相同不触发 render。
- 首次观察到非 `undefined` 的有效值会触发 render，`previousValue` 为 `undefined`。
- 首次观察到 `undefined` 只记录 baseline，不插入消息。
- `hasValue` 用于区分 `undefined` 与 `null`。
- `Watch` 生成的消息会带 `systemMessageKind: "variable_change"` 和 `watchedVariableKey`。

适合 watch 的变量：

- 当前章节标签。
- 当前选中资源。
- 需要作为长期历史事件保留的外部状态切换。

如果只是要靠近当前输入提醒模型，例如当前 workspace，优先使用 `Reminder watchPath="scope.studio.workspace"`。

## 一轮请求示例

第一次请求，直接 prompt 模式，用户输入 `你好`：

```text
1. HistorySet
   - SystemMessage: 你是一个 Agent
   - SystemMessage: 可用 Skills
2. DynamicSet
   - 本轮临时上下文
3. AppendingSet
   - SystemMessage: 当前 workspace reminder（写入历史）
   - HumanMessage: 你好（source="input"，写入历史）
```

第二次请求，leader UI continue 模式，历史尾部已存在用户输入 `当前是什么模式`：

```text
1. HistoryWithoutCurrentUserInput
   - 已持久化 system prompt
   - 已持久化 skill catalog
   - 上一轮 user / assistant 历史
2. DynamicSet
   - 本轮临时上下文
3. AppendingSet
   - SystemMessage: Plan Mode reminder（插入到当前用户输入之前）
4. CurrentUserInput
   - HumanMessage: 当前是什么模式
```

## 相关实现

- `server/agent/profiles/simple-profile.ts`：`SimpleProfile` 的真实上下文拼装、continue 拆分、Reminder / Watch 渲染。
- `server/agent/profiles/context-prompt.tsx`：`ProfilePrompt`、`HistorySet`、`DynamicSet`、`AppendingSet`、`Reminder`、`Watch` 等 TSX 节点定义。
- `server/agent/prompts/components.tsx`：通用 `Message`、`History`、`If` 节点。
- `server/agent/profiles/simple-profile.test.ts`：基础上下文顺序和持久化语义测试。
- `server/agent/profiles/test/complex-prompt.prepare-messages.test.ts`：复杂 profile 的多轮消息序列 fixture 测试。
