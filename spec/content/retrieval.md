# Content Node Retrieval And Inject

内容节点进入 Agent 上下文分为两条路径：`inject` 与 `retrieval`。

## Frontmatter

标准内容节点 `index.md` frontmatter 包含：

```yaml
retrieval:
  enabled: true
  trigger: null
inject:
  profiles: []
  always: false
```

字段语义：

- `retrieval.enabled`：是否允许该节点进入 AI 自动检索候选。
- `retrieval.trigger`：自然语言触发条件。为空表示不需要额外触发判断。
- `inject.profiles`：允许直接注入该节点的 profile key 列表，例如 `subagent.writer`。
- `inject.always`：是否对 `inject.profiles` 中的目标 profile 默认直接注入。

`inject` 用于稳定、长期、低判断成本的上下文，例如写作风格、叙事视角、全局禁忌。`retrieval` 用于需要根据任务、章节大纲、最近正文和场景判断是否相关的内容节点。

## Retrieval Profile

`subagent.retrieval` 是专门的内容节点召回 profile。它允许使用 shell 搜索能力，例如 `rg`，也可以读取候选文件，但不编辑文件。

输入结构：

```ts
{
    targetProfile: string;
    task: string;
    prompt: string;
    chapterOutline?: string;
    recentText?: string;
    constraints?: string[];
    maxEntries?: number;
}
```

输出必须通过 `report_result` 工具提交完成结果。`report_result.data` 是有序内容节点路径数组：

```ts
string[]
```

下游 profile 不读取一个全局 `RetrievedContentNodes` prompt 组件，而是由调用方把路径数组映射到目标 profile 的参数。

## Writer Flow

推荐流程：

1. Leader 或系统入口先创建并调用 `subagent.retrieval`。
2. Retrieval profile 根据任务和最近上下文召回内容节点，调用 `report_result` 返回 `data: string[]`。
3. Leader 或系统入口把路径数组映射为 `subagent.writer` 的 `lorebookEntries` 参数。
4. Writer 按 `priority` 从小到大读取每个内容节点的 `index.md` 与同级可选 `state.md`，并注入 prompt。

这种设计让 retriever 专注路径选择，让 writer 获得完整文件上下文，同时不要求 writer 自己调用工具或进行多轮搜索。
