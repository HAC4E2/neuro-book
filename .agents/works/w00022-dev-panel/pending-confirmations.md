# 待确认清单

开发者 2026-10-12 指定按 autonomous-delivery 推进：下面这些照推荐做了，等开发者事后追认或改判。每行写日期、Task、类别、决定、理由、改回的代价与链接；追认或改判后在“结果”里写明。

| 日期 | Task | 类别 | 决定 | 理由 | 改回的代价 | 结果 |
|---|---|---|---|---|---|---|
| 2026-10-12 | 全部 | 推进方式 | 实现 Task 共用集成分支 `feat/w00022-dev-panel` 与 worktree `.worktree/w00022-dev-panel`，不按“一个 Task 一个 worktree” | Task 严格先后依赖，合入 `master` 要授权，每片单开 worktree 只会多出一串互相叠加的分支 | 低：之后的 Task 改为各开 worktree 即可 | |
| 2026-10-12 | 全部 | 推进方式 | 编码交给 opus 子代理，主会话调度、审查 diff、自跑验证；autonomous-delivery 原写主会话自己实现线性切片 | 开发者此前要求“主会话调度与讨论、派子代理实施” | 无 | |
| 2026-10-12 | t06 | CI 范围 | `packages/dev-panel/**` 照现有测试同时加进 code-baseline 与 product-platforms 的触发路径 | 现有 `workspace-workflows.test.ts` 要求每个包都在这两处；不擅自改测试的约束 | 低：改为在测试里列出开发工具豁免 product-platforms，删掉那两行路径；好处是改面板不触发产品构建 | |
| 2026-10-12 | t06 | 记录写法 | `nbdev work new` 建出的 Work README 不放 Task 表，`task new` 也不改 Work README；Task 列表以目录与 `nbdev status` 为准 | 命令行不改 README 正文，表会过时 | 低：模板加表、`task new` 追加一行 | |
| 2026-10-12 | t06 | 撞号 | 真实仓库里 w00007 有两个不同的 Work（`w00007-workflow-message-only-invoke` 在 master，`w00007-desktop-supervisor-portable-fix` 只在 `origin/fix/windows-supervisor-bun`，2026-08-30）；nbdev 会把它列为撞号，不自动改名 | 设计审查核实是真实的重复分配 | 无；要处理就按 Work 规则给远程分支那一个改号 | |
