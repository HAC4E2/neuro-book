# Route B P3：确定性检索与章节规划 Workflow 实施计划

## 目标

在 P2 已批准的 Storyboard / Tag Pattern / Character V2 / Tag index 真相源之上，建立一个可独立验证的 plan-only 纵切：服务端冻结已保存章节快照与闭集候选，`illustration.director` 只通过窄工具产生严格 Shot Intent，持久 Workflow/Attempt 负责幂等、排队、取消与恢复；本阶段不写 `illustrations.md`、不插正文按钮、不创建图片 Job，也不调用 NovelAI。

## 冻结边界

- Pattern 与 Tag 查询只返回有界 typed 摘要；Agent 不读取 Markdown 全文、tier JSON、SQLite、Provider secret 或 Recipe 生成参数。
- `plan-chapter` 的锚点只能引用服务端生成的候选；`plan-selection` 输出不含锚点，服务端固定可信插入点。
- `planningRequestHash` 只表达稳定幂等身份；`planningInputHash` 冻结完整输入证据；Agent 输出与工具调用不能反向进入 request hash。
- 同一 Project、章节、operation、request hash 先原子 upsert Workflow，scheduler 领取后才分配 Attempt / Agent session。
- P3 结果停在 validated proposal / preview。`illustrations.md`、Prompt Placeholder V2 与 Planning Apply Journal 在 P4 实现。
- 不引入旧 detector/completion/placer adapter，不建立浏览器/localStorage 第二真相源，不开放任何 NovelAI 参数写面。

## 实施步骤

### 1. Pattern retrieval strict contract 与确定性 ranking

文件：

- `shared/text-to-image-tag-pattern-retrieval.ts`
- `shared/text-to-image-tag-pattern-retrieval.test.ts`
- `server/text-to-image/tag-pattern-retrieval.ts`
- `server/text-to-image/tag-pattern-retrieval.test.ts`

先写 RED，覆盖：NFKC case-fold、always/trigger、`any + andAny`、角色数、intent、canvas、rating、Provider/model scope、disabled 排除、稳定 tie-break、3–8 candidate cap、get 闭集与 `candidateSetHash`。typed 摘要不含完整 Prompt、Recipe、Provider 参数或原始 instruction。

### 2. Agent Tag / Pattern 窄工具

文件：

- `server/agent/tools/illustration-planning-tools.ts`
- `server/agent/tools/illustration-planning-tools.test.ts`
- `server/agent/tools/index.ts`

把 P2 `TagResolverService` 和本步 retrieval 包装为 `resolve_tags`、`suggest_tag_replacements`、`finalize_tag_resolution`、`search_tags`、`related_tags`、`validate_tag_resolutions`、`search_tag_patterns`、`get_tag_patterns`。所有调用必须绑定当前 invocation/run、Project policy、generic NovelAI scope 与冻结 candidate 闭集；结果数量和调用预算硬限制，工具无 workspace 写权限。

### 3. 章节 parser、稳定 block anchor 与 selection fingerprint

文件：

- `shared/text-to-image-illustration-planning.ts`
- `shared/text-to-image-illustration-planning.test.ts`
- `server/text-to-image/illustration-chapter-parser.ts`
- `server/text-to-image/illustration-chapter-parser.test.ts`

解析已保存 Markdown 为规范顶层 block 快照，严格拒绝 frontmatter、代码块、HTML block 与仅受管节点选区。生成稳定 anchor candidate、清理后 `sourceChapterHash`、`selectedTextHash`、首尾 block-local offset、`selectionHash` 与固定 `insertAfterAnchorId`。重复文本必须结合 line/text hint 与 block fingerprint 消歧；仍不唯一返回 `ILLUSTRATION_SELECTION_AMBIGUOUS`。

### 4. Planning Input / Output、校验器与 hash 分层

文件：

- `shared/text-to-image-illustration-planning.ts`
- `server/text-to-image/illustration-plan-validator.ts`
- `server/text-to-image/illustration-plan-validator.test.ts`

建立 strict Chapter / Selection proposal、Planning Input Bundle、continuity baseline、closed character/outfit candidates、Pattern candidates、terminal Tag ref 与 evidence DTO。校验 selection 恰好一条、chapter 非空完整计划、闭集 entity / outfit / pattern / anchor、terminal Tag resolution 资格、数量上限及所有禁写字段。服务端分配 identity 前计算稳定 `shotIntentHash`；输出 XML/Markdown/最终 Prompt/Provider/Recipe/NovelAI 参数整体拒绝。

### 5. Director operation 与 plan-only Skill

文件：

- `assets/workspace/.nbook/agent/profiles/builtin/illustration.director.profile.tsx`
- `assets/workspace/.nbook/agent/skills/chapter-illustration-direction/SKILL.md`
- `server/agent/profiles/illustration-director-assets.test.ts`

扩展 `InitialSchema` / `OutputSchema` 的 `plan-chapter` 与 `plan-selection`。runtime 按 operation 只注入 Tag / Pattern / submit-plan / report 工具；prompt 把正文、选区与 preset 明确标为不可信数据，并要求同一 bounded run 完成整章连续性复核。无 shell、通用文件、网络、配置、NovelAI 或写章节工具。

### 6. Project SQLite Workflow / Attempt 与 scheduler

文件：

- `prisma/project.schema.prisma`
- `server/workspace-files/project-workspace.ts`
- `server/text-to-image/illustration-workflow.repository.ts`
- `server/text-to-image/illustration-workflow.scheduler.ts`
- 对应聚焦测试

新增 Workflow / Attempt 持久模型与唯一键；JSON 字段只保存已由 strict schema 验证的 bundle/proposal/evidence。同步 start 在任何 session 分配前冻结输入并 upsert；scheduler 以 CAS 领取 queued workflow，按 Director settings 限制 1–4 并发，创建独立 attempt/session，支持显式 retry、取消、重启 interrupted -> queued/stale。相同 request hash 复用 active/ready workflow，显式 nonce 创建新 revision。

### 7. API 与只读 preview UI

文件：

- `server/api/text-to-image/illustration-workflows/**`
- `app/components/novel-ide/text-to-image/TextToImageIllustrationPlanningPanel.vue`
- 相关 API/UI contract tests

提供 start/status/list/cancel/retry 与 validated proposal preview。API 只接收 Project、chapter、operation、选区定位提示、规范化用户意图/replan nonce；actor、hash、binding、policy、candidate、session 均由服务端产生。前端状态按 workflowId + chapterPath 保存，不把模型或生成参数写回 Profile / Storyboard / localStorage。

## 验证门

- 聚焦测试证明 exact tail Tag 不被高频无关项压过；Pattern 只返回 3–8 closed candidates，disabled/越 scope 永不出现。
- chapter/selection 锚点与 hash fixture 覆盖跨段、列表/引用、重复文本、受管节点清理、无效 block 与 client 坐标不入 hash。
- 恶意正文、Pattern、preset 或 Agent DTO 不能注入工具、锚点、最终 Prompt、Provider/Recipe/NovelAI 参数。
- 同 requestHash 双击只产生一条 Workflow / 一个 active Attempt；两个章节可并发且 session/result 不串线；重启恢复与输入漂移 fail-closed。
- plan-only 全链静态与运行测试证明不写章节、不写 `illustrations.md`、不创建 Job、不调用 NovelAI。
- 运行 P3 聚焦组合、受影响 P0/P2 回归与完整 `bun run typecheck`；Project Prisma schema 变化后运行 generate。

## 预期计划差异记录

- 冻结路线表把 Planning Apply Journal 明确放在 P4；因此本计划不提前把 plan-only proposal 发布为正文按钮。若后续用户要求一个可点击端到端纵切，将在 P3 通过后另起 P4 详细计划，而不是在 scheduler 内夹带文件写入。

## 2026-07-20 实际结果

- 已完成步骤 1–6 的 plan-only 基础：deterministic Pattern retrieval、run-scoped 窄工具、章节/选区 parser、严格 Input/Proposal/Validated Plan、Director operation/Skill、Project SQLite Workflow/Attempt 与 scheduler。
- 步骤 7 已完成 start/list/get API、只读 Workflow preview、整章工具栏入口和 TipTap 选区入口。实际组件命名为 `TextToImageIllustrationWorkflowPanel.vue`，因为页面呈现的是持久 Workflow 状态而非临时 planning form。
- Planning Input Builder 在 Workflow 创建前冻结 portable Project ID、已保存章节、effective overlays、Character/Outfit V2、Recipe planning constraints、Director binding fingerprint、Tag Policy/index identity、Pattern closure 与 continuity baseline；Agent/工具无法取得 Provider secret 或 NovelAI 执行参数。
- 选区入口复用 TipTap 现有可信行范围，但 raw Markdown offset 与 `chapterFileHash` 从刚保存正文重新计算；不能唯一证明时失败关闭。
- 实际验证为 `15 files / 56 tests passed`；Project Prisma generate 成功，generate 后 Project migration/repository `2 files / 7 tests passed`，最终完整 `bun run typecheck` exit 0（129.4 秒）。
- 与计划的差异：2026-07-20 第一纵切当时尚缺显式 cancel/retry、进程重启 recovery 扫描与 replan 操作 UI；这些缺口已在下述 2026-07-21 hardening 闭合。按冻结规格，`illustrations.md`、Placeholder、Apply Journal、Job 和 NovelAI 执行仍属于 P4。

## 2026-07-21 P3 hardening 实际结果

- `IllustrationPlanningInputBuilder.rebuild()` 只使用旧 bundle 的冻结请求语义与当前服务端真相源。整章会从当前已保存正文重建；选区只有在 `chapterFileHash` 精确一致、冻结锚点仍属于当前 parser 闭集时才复用服务端 selection snapshot，否则返回 `ILLUSTRATION_WORKFLOW_STALE`。
- repository 新增单 Workflow cancel CAS、restart recover、recoverable scan、stale 标记与迟到结果查询。取消只关闭目标 active Attempt；重启把旧 created/running/succeeded Attempt 统一记为 `interrupted`，清空 active/proposal preview，只有 request/input 两层 hash 完全一致才回到 `queued`，否则进入 `stale`。
- scheduler 为每个 workflowId 保存独立取消信号与 session；持久 canceled 先提交，Agent Harness abort 只是尽快回收运行资源。任何取消后的迟到 completed/canceled/error 都由 repository 状态栅栏丢弃，不会把 canceled 覆盖成 failed/ready。
- service 以“每进程、每个已打开 Project 首次访问一次”的恢复门替代全盘 boot scan；这避免建立 App 级 Project 第二索引，也保证所有恢复仍经过 Project-open guard。retry 会先从当前真相源重建并精确比 hash；replan 由服务端生成 nonce、绑定用户 reason，并创建新的 request identity/Workflow。
- 新增 strict cancel/retry/replan POST API 与面板操作。浏览器只提交 `projectPath`，replan 额外提交 reason；不接收 hash、provider/model、Recipe、session 或 actor。面板使用全局通知与确认/输入 Dialog，不保存 localStorage 状态或第二份配置。
- stale 错误码已从实现偏差 `ILLUSTRATION_WORKFLOW_INPUT_STALE` 硬切到冻结合同 `ILLUSTRATION_WORKFLOW_STALE`，不保留兼容别名。本批没有 Prisma schema 变化，因此未重复 generate。
- TDD 首轮为 `5 files / 20 tests`，新增 10 项按预期 RED；最终服务端/API/UI hardening 组合为 `6 files / 21 tests passed`。typecheck 首轮准确暴露持久 selection context 与 parser 内部行号类型错位；收窄内部类型后最小 builder `4 tests passed`，最终完整 `bun run typecheck` exit 0（141.6 秒）。按规则未自动做浏览器验证，也未提交、推送或发布。
