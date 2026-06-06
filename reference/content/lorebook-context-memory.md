# Lorebook Context Memory

Lorebook context memory 用来替代内容节点 frontmatter 中的 `inject.profiles` / `inject.always`。它表达“某个 profile 当前应该优先读取哪些条目”，而不是让条目自己声明要进入哪些 profile。

## File Layout

```text
{project}/
|-- lorebook/
|   `-- context/
|       |-- leader.default.md
|       |-- simulator.leader.md
|       |-- director.md
|       |-- writer.md
|       `-- generated/
|           |-- leader.default.md
|           |-- simulator.leader.md
|           |-- director.md
|           `-- writer.md
`-- .nbook/
    `-- context-access/
        |-- leader.default.json
        |-- simulator.leader.json
        |-- director.json
        `-- writer.json
```

- `lorebook/context/{profile}.md`：Agent 自主维护的 profile-scoped context memory。
- `lorebook/context/generated/{profile}.md`：程序根据访问状态渲染的结构化推荐文本，Agent 可读。
- `.nbook/context-access/{profile}.json`：程序私有访问状态，Agent 默认不读。

## Agent-Maintained Context

`lorebook/context/{profile}.md` 的 frontmatter 可以包含：

```yaml
profile: writer
version: 1
updatedAt: "2026-06-06T00:00:00+08:00"
updatedBy: agent
mustRead: []
candidates: []
blocked: []
```

条目使用 Project-relative path，例如 `lorebook/location/castle/`，不要写绝对路径。程序第一版只要求稳健读取 `path`，`note`、`priority`、`setBy`、`updatedAt` 等字段允许缺省。

正文用于上下文分析、接手说明、候选判断和待确认问题。不要在正文里放稳定 profile policy；稳定规则仍属于 profile prompt、`reference/` 或 workflow 文档。

`mustRead` 不是无条件注入。它表示当前 profile 在任务开始时应优先检查或读取的条目，仍受任务目标、token、权限和信息边界约束。

## Generated Recommendations

`lorebook/context/generated/{profile}.md` 是程序覆盖的结构化文本，可以没有 frontmatter。推荐 section 固定为：

- `strong`：程序认为当前 profile 很可能需要的条目。
- `possible`：可能相关，需要 Agent 结合任务判断。
- `avoid`：不应默认进入该 profile 上下文的条目或目录。

条目只保留事实数据，例如：

```md
## possible

### lorebook/character/hero/

- score: 0.54
- signals: read:2, explicitInput:1
- lastAccessedAt: 2026-06-06T00:00:00+08:00
- sessions: 1
```

不要写长篇推荐原因。Agent 如果采纳推荐，应把判断整理到自己的 `lorebook/context/{profile}.md`。

## Profile Isolation

当前 profile 只能自动读取自己的 context memory：

- `lorebook/context/{profile}.md`
- `lorebook/context/generated/{profile}.md`

不能自动读取其他 profile 的 context memory 或 `.nbook/context-access`。例如 `writer` 不能读取 `lorebook/context/leader.default.md`、`lorebook/context/simulator.leader.md` 或对应 generated 文件。

跨 profile 信息只能通过显式 handoff、writer-safe brief、invocation input 或 retrieval 结果传递。跨 profile 推荐可以暴露事实信号，例如 `leader-read:3`，但不能泄漏 source profile 私有 context 正文。

## Program State

`.nbook/context-access/{profile}.json` 保存程序私有访问事实：

- `path` 必须是 Project-relative path。
- 读取 `lorebook/foo/bar/index.md` 与同级 `state.md` 都归一到 `lorebook/foo/bar/`。
- 用 signals 区分 `index-read`、`state-read`、`explicitInput` 等来源。
- 程序可以频繁更新它，但它不是 Agent 默认上下文入口。
