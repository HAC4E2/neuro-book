# AgentProfile 实现指南

## 文档目的

本文档说明 `server/agent/profiles` 下 `AgentProfile` 家族的职责边界、生命周期、TSX prompt 写法，以及新增 Profile 时的推荐规则。

相关文档：

- [system.md](system.md)
- [context.md](context.md)

## Profile 类族

### `AgentProfile`

文件：[agent-profile.ts](../../server/agent/profiles/agent-profile.ts)

最低层抽象，适合完全自定义 `prepare()` / `ingest()` 的复杂 profile。它要求实现：

- `key`
- `kind`
- `name`
- `inputSchema`
- `outputSchema`（可选；存在时 `report_result.data` 必须符合该结构）
- `allowedToolKeys`
- `prepare(runtime)`

它还提供默认 `ingest(input)` 透传实现。需要过滤或改写 ReAct loop 产物写回历史时，再覆盖 `ingest()`。

只有默认上下文编排明显不适合时，才直接继承它。

### `SimpleProfile`

文件：[simple-profile.ts](../../server/agent/profiles/simple-profile.ts)

当前推荐基类。它提供：

- `HistorySet -> DynamicSet -> AppendingSet` 的标准拼接顺序
- system prompt 首轮持久化与去重
- watched variables baseline / diff
- skill catalog 与显式 activated skill 文本构造
- `AppendingSet` 消息追加写回
- `<Message source="input">` 写回

当前内置 profile：

- [leader-default.profile.tsx](../../server/agent/profiles/builtin/leader-default.profile.tsx)
- [writer.profile.tsx](../../server/agent/profiles/builtin/writer.profile.tsx)
- [retrieval.profile.tsx](../../server/agent/profiles/builtin/retrieval.profile.tsx)

## 运行时生命周期

1. `AgentSystem` 校验输入并构造 `ProfileContextRuntime`。
2. `profile.prepare(runtime)` 生成 `modelMessages`、`persistedMessages`、`immediateMetadata` 和 `completedMetadata`。
3. `ThreadRunCoordinator` 先写入 `persistedMessages.prepend/append`，提交 `immediateMetadata`，再把 `modelMessages` 交给模型。
4. assistant / tool 结果经 `profile.ingest()` 处理后进入消息历史。
5. run completed 后写回 `completedMetadata`。

重点：

- `modelMessages` 是本轮给模型看的完整消息。
- `persistedMessages.prepend` 是 run 开始前写入历史根部的稳定前缀。
- `persistedMessages.append` 是 run 开始前写入当前历史光标的运行期上下文。
- `DynamicSet` 不进入 `persistedMessages`。
- `AppendingSet` 位于最新上下文，适合贴近本轮输入的内容，并会写入 `persistedMessages.append`。
- `SkillCatalog` 放在 `HistorySet` 时会随首轮 system prompt 写入历史。

## runtime 里有什么

`ProfileContextRuntime` 常用字段：

- `thread`：当前线程记录和 metadata。
- `profile`：当前 profile 实例。
- `input`：通过 `inputSchema` 校验后的本轮输入。
- `scope`：本轮变量快照，不是响应式对象。
- `skillCatalog`：当前仓库可见 skill 元数据列表。
- `options`：本轮运行选项，例如 plan mode reminder。
- `messageStore`：消息历史存储。
- `loadHistoryMessages()`：加载当前活动分支可发给模型的 history messages。

`ProfilePromptContext` 会把常用值整理给 `buildPrompt(ctx)`：

- `ctx.runtime`
- `ctx.input`
- `ctx.scope`
- `ctx.history`
- `ctx.skillCatalogText`
- `ctx.activatedSkillsText`
- `ctx.var("scope.xxx")`
- `ctx.hasTool("tool_key")`

## TSX Prompt 合同

`SimpleProfile` 子类只实现一个函数：

```tsx
protected override buildPrompt(ctx: ProfilePromptContext<"profile.key">) {
    return (
        <ProfilePrompt>
            <HistorySet>...</HistorySet>
            <DynamicSet>...</DynamicSet>
            <AppendingSet>...</AppendingSet>
        </ProfilePrompt>
    );
}
```

`ProfilePrompt` 顶层推荐显式包含：

- `HistorySet`
- `DynamicSet`
- `AppendingSet`

裸 `<Message>` 等普通节点可以直接放在 `ProfilePrompt` 顶层，但会被视为 dynamic 上下文，不写入历史。复杂 profile 仍建议显式写出 set，降低阅读成本。

### `HistorySet`

只放长期稳定上下文。

允许节点：

- 普通 `Message`
- `History`
- `SkillCatalog` 返回的 string 片段，需包裹在 `Message` 内

推荐使用 `<Message role="system">` 表达主系统提示。生成的 system message 会在缺少持久化 system prompt 时写入历史根部。`SkillCatalog` 返回 string，通常写成 `<Message role="system"><SkillCatalog text={ctx.skillCatalogText} /></Message>`。

不要放：

- `Watch`

### `DynamicSet`

只放本轮动态状态，不持久化。

允许节点：

- 普通 `Message`
- `History`

典型内容：

- 当前线程标题、摘要
- 当前 IDE / workspace / chapter 状态
- 当前可用工具
- 当前任务状态
- 当前 subagent 状态

不要放 `SkillCatalog` 或 `Reminder`。`SkillCatalog` 需要首轮持久化时放在 `HistorySet`；`Reminder` 应贴近当前用户输入，放在 `AppendingSet`。

### `AppendingSet`

贴近当前输入的上下文区域。leader UI continue 主路径下，当前用户输入来自 history 尾部，`SimpleProfile` 会把它移动到 `AppendingSet` 之后，确保用户输入是模型最后一条消息。`AppendingSet` 渲染出的非空消息会写入当前历史光标。

推荐顺序：

```tsx
<AppendingSet>
    <Reminder id="leader-runtime"><Message role="human">当前剧情焦点、subagent、任务状态</Message></Reminder>
    <Reminder id="workspace" watchPath="scope.studio.workspace" repeatEveryTurns={5}><Message role="system">当前 workspace</Message></Reminder>
    <Reminder id="plan-mode"><Message role="system">本轮 Plan Mode reminder</Message></Reminder>
    <Watch ... />
    {ctx.activatedSkillsText ? <Message role="human"><ActivatedSkills text={ctx.activatedSkillsText} /></Message> : null}
    {shouldAppendInput ? <Message role="human" source="input">{promptText}</Message> : null}
</AppendingSet>
```

节点语义：

- `Reminder`：控制提醒的追加时机；内部用普通 `<Message>` 决定 role 和内容，可通过 `watchPath` 变量变化触发，或通过 `repeatEveryTurns` 周期性补注入。生成的消息属于 `AppendingSet`，会写入历史。
- `Watch`：变量变化时插入系统生成消息并写入历史；消息带 `systemMessageKind: "variable_change"`。
- `ActivatedSkills`：显式 `$skill-name` 命中时读取 `SKILL.md`，返回激活内容 string，通常包在 `<Message role="human">` 内。
- `<Message source="input">`：直接 prompt 模式的本轮真实用户输入会写入历史；continue 模式不会追加，当前用户输入来自 history 尾部。

`AppendingSet` 不接受裸文本；文本必须放在 `Message` 内。

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

适合 watch 的变量：

- 当前章节标签
- 当前选中资源
- 需要作为 `systemMessageKind: "variable_change"` 长期写入历史的外部状态切换

如果只是要靠近当前输入提醒模型，例如当前 workspace，优先使用 `Reminder watchPath="scope.studio.workspace"`。

不适合 watch 的变量：

- 高频噪音字段
- 大对象
- 只在当前 prompt 内部使用的临时字段

## 最小实现骨架

```tsx
/** @jsxRuntime automatic */
/** @jsxImportSource nbook/server/agent/prompts */

import {Message} from "nbook/server/agent/prompts";
import {
    ActivatedSkills,
    AppendingSet,
    DynamicSet,
    HistorySet,
    ProfilePrompt,
    Reminder,
    SimpleProfile,
    SkillCatalog,
    type ProfilePromptContext,
} from "nbook/server/agent/profiles/simple-profile";
import {SomeInputSchema, SomeOutputSchema} from "nbook/server/agent/profiles/builtin/some.contract";

export class SomeProfile extends SimpleProfile<"some.profile"> {
    readonly key = "some.profile";
    readonly kind = "subagent" as const;
    readonly name = "SomeProfile";
    readonly inputSchema = SomeInputSchema;
    override readonly outputSchema = SomeOutputSchema;
    readonly allowedToolKeys = ["read_file"] as const;

    protected override buildPrompt(ctx: ProfilePromptContext<"some.profile">) {
        const workspace = ctx.scope.studio.workspace ?? "";
        const prompt = "prompt" in ctx.input ? ctx.input.prompt : "";

        return (
            <ProfilePrompt>
                <HistorySet>
                    <Message role="system">
                        你是某个专职 subagent。
                    </Message>
                    {ctx.skillCatalogText ? (
                        <Message role="system">
                            <SkillCatalog text={ctx.skillCatalogText} />
                        </Message>
                    ) : null}
                </HistorySet>
                <DynamicSet />
                <AppendingSet>
                    <Reminder id="workspace" when={Boolean(workspace)} watchPath="scope.studio.workspace" repeatEveryTurns={5}>
                        <Message role="system">
                            {`当前工作区：${workspace}`}
                        </Message>
                    </Reminder>
                    {ctx.activatedSkillsText ? (
                        <Message role="human">
                            <ActivatedSkills text={ctx.activatedSkillsText} />
                        </Message>
                    ) : null}
                    <Message role="human" source="input">
                        {prompt}
                    </Message>
                </AppendingSet>
            </ProfilePrompt>
        );
    }
}
```

## 落地检查清单

新增或修改 profile 后，至少检查：

- `inputSchema` 是否已加入 `ProfileInputMap`。
- 需要结构化结果的 profile 是否声明了 `outputSchema`，并已加入 `ProfileOutputMap`。
- `key` / `kind` / `allowedToolKeys` 是否正确。
- `HistorySet` 是否只放稳定约束，以及需要首轮持久化的 `SkillCatalog` string message。
- `DynamicSet` 是否没有放 `Reminder` / `SkillCatalog` 等异地节点。
- `AppendingSet` 是否贴近当前输入，`Reminder` / `Watch` / `ActivatedSkills` / input message 顺序是否合理。
- continue 模式是否关闭 `<Message source="input">` 追加，并保证 history 尾部当前用户输入是模型最后一条。
- `Watch` 是否只监听对模型有意义的变量。
- 新 TSX 节点位置是否有定向测试覆盖。
- profile 是否已在 registry 中注册。
