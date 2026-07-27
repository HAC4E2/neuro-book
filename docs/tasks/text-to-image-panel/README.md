# Text To Image Panel

## 2026-07-27 上游同步合并（text-to-picture ← HAC4E2/master）与集成修复

### 合并谱系修复

- 历史上的"合并"提交 `6ec38173` 是单亲快照式假合并，直接 merge origin/master 产生 247 个 add/add 冲突。通过内容指纹扫描定位真实快照基线为上游提交 `97c698f7`，用 `git replace --graft 6ec38173 5749ef21 97c698f7` 修正 merge-base 后冲突收敛为 25 个真实语义冲突，逐个手工解决。合并提交落地后已删除 replace ref（graft 只在本地生效，不随 push 传播）。

### 上游 Task 118 适配：文生图 Prisma client 迁入 ProjectModule

- 上游删除了 `registerProjectResourceOwner`/`ProjectResourceOwner`，close/readiness 真相源统一为 ProjectModule registry。`server/text-to-image/project-client.ts` 的进程级缓存 Map 迁移为 lazy ProjectModule：新增 `project-client-module.ts`（`ProjectModuleName` 闭合并集扩展 `"text-to-image"`，进 `LAZY_MODULE_ORDER`），handle 首次数据面访问才打开 client，Project close/重开由 Session generation 统一驱动 close；`project-session.ts` composition root 增加副作用注册导入。`textToImageProjectClient()` 签名不变（内部改走 `requireReadyProjectPath` + `activateReadyProjectModule`），`withEphemeralTextToImageProjectClient` 短连接入口保持原样。`closeTextToImageProjectClient` 删除，6 个测试文件清理旧 owner 注册（清理统一由 `closeProjectForTest` 驱动）。

### 跟随上游 sidecar 机制删除（Task 111 PLAN-E）

- 合并中 harness 的 sidecar 引擎"消失"最初被误判为 automerge 丢代码并做了部分恢复；核查 `simulator.actor.profile.tsx` 注释确认是上游有意删除（"后续由 workflow/job 形态重建"）。已回滚全部恢复：`profiles/types.ts` sidecar 类型块、`control-tools.ts` sidecar 工具与 `activeSidecar` 守卫、`tools/index.ts` 导出、`report-result-schema.ts` 两个 sidecar 函数与对应测试、harness 四处引用。保留我们自己的 dataContract 改进（显式 `dataSchema` 必填、union schema 不被误判为空、adhoc 动态 schema 优先）。

### 树索引失效与后台记账合同修复（比类型错误更重的运行期问题）

- 上游新合同：project-workspace 的树索引失效必须携带当前 generation 的 file-index handle，缺失直接 throw。我们分支有 7 处调用是 `{target: ...} as any` 伪造形状（静默失效丢失）或缺 handle（运行期必炸）：planning-apply×4、recipe、project-overlay、character-visual-migration。统一改为 `compat.ts` 新增的 `invalidateProjectTreeIndex(projectPath)`（内部 `requireReadyModuleHandle(file-index).invalidate()`；Project 已关闭时静默跳过）。
- `writeResolvedProjectTextFileTracked`/`deleteResolvedProjectFileTracked` 原来把 `{projectRoot, projectPath, ...}` 伪 handle 传给 `recordProjectWrite`，记账永远 fail-open 漏账；改为 `tryReadyProjectHistoryHandle` 解析真实 generation handle（Project 开着就正常记账，关了才 fail-open 交对账）。project-overlay 一处 `writeWorkspaceTextFileTracked(writeWorkspaceTextFileTracked(...))` 嵌套双调用 bug 一并修正为 `writeResolvedProjectTextFileTracked`。
- 循环导入根因修复：`tracked-workspace-files.ts` 在 module init 期用 `LOCAL_USER_ID` 构造 `USER_LOCAL_ACTOR`，而 project-history → config-service → agent harness → file-tools → tracked-workspace-files 成环，vite SSR 转换不抛 TDZ 而是静默捕获 undefined，导致 vitest 环境下所有 user 写入记账 `actor_user_id: undefined` 入库报错（fail-open 后账面为空）。`USER_LOCAL_ACTOR` 定义移入 project-history 与 `LOCAL_USER_ID` 同模块，tracked 侧 re-export 保持消费方 import 路径不变。`tracked-workspace-files.test.ts` 6/6 转绿。

### 依赖与 typecheck 收敛

- 补 `ofetch@1.5.1` 直接依赖（上游 4 个文件裸导入但未声明）、`@types/mdast`（`shared/agent/agent-image-markdown.ts`）；`bun run generate` 重新生成 Prisma client（PassportCredential）。
- 新增根级 `bun-ffi.d.ts` 最小环境声明：上游 tsconfig include 不含 `server/workspace-files/**`，我们把 `server/text-to-image/**` 纳入后 `project-root-reparse-windows.ts` 的 `bun:ffi` 导入被传递性检查；不引入完整 bun-types 避免 Bun/Node 全局类型冲突。
- `resolveGlobalProfileNbookRoot` 返回类型收窄为 `AbsoluteFsPath`（一次修掉 overlay/storyboard-import/storyboard-publish 三处 branded 报错）；`useModelSettingsDraftSession` 的 `visibleModels` 显式提升修 TS2719。
- 全量 typecheck 收敛到已记录的 llmlint 基线（27 个，全部在 vendored skill 内）。

### 验证与已知问题

- 聚焦测试：text-to-image 全目录（低并发下全绿）、tracked-workspace-files 6/6、project-module/database/plot module、report-result-schema/control-tools/builtin-smoke 全部通过。本机全并发跑大套件会因 import 开销把部分重测试推过 5s 默认超时（route-b-old-chain-removal 审计已按仓库增大显式提到 60s）。
- 测试夹具可移植性：上游 `test-workspace-fixture.ts` 对 package.json 等文件用 file symlink（Windows 非开发者模式 EPERM），加了 EPERM→copyFile 降级。
- 已知上游测试债（origin/master 同样失败，不属于本合并）：`rp-profiles.test.ts`/`leader-assets-profile.test.ts` 断言的 "Runtime Location" 字样在上游源码中已不存在（reminder 措辞改为 File Scope 后测试未同步）；catalog 全量 profile 编译在本机可超 60s。

## 2026-07-27 端到端测试暴露的六项修复（dispatch P0 / 图片渲染 / 重roll / 迁移面板 / Recipe 首开 / 失败规划出路）

### 用户问题与根因

- 浏览器端到端测试（新书 + 角色 tag 生成 + 正文生图 + 全新人物章节）暴露六个问题；修复顺序按用户确认的优先级执行。
- P0：`project-illustration-dispatch.ts` 把 reference resolver 传进 `requestCompiledNovelAiImage` 的 `fetchImpl` 参数位，生产路径所有 illustration Job 100% 崩为 `outcome_unknown: fetchImpl is not a function`。能过编译的根因是 `bun run typecheck` 的 tsconfig include 从未覆盖 `server/text-to-image/**`。
- 编辑器里项目内图片全部裂图：TipTap 官方 Image 扩展把 markdown 相对 destination 原样塞进 `img[src]`，Nuxt 对 `/assets/...` 返回 200 HTML 兜底；服务端旧预览路由 `/api/text-to-image/image` 要求绝对路径、无 Project guard 且全仓库零消费者。
- 已插入正文的插图没有任何重roll路径：资产详情"重新生成"走旧 Queue retry（illustration kind 被四层排除）；占位块状态服务对 terminal Job 永久短路，failed 占位块死锁。
- `TextToImageCharacterMigrationPanel` 零挂载（A1 残留），角色详情页 proposal 之后的 resolve/accept/apply 无 UI 入口。
- 新 Project 第一次点正文生图必报"尚未保存文生图 Recipe"（首开自动落盘缺失）。
- 规划失败后再点正文生图：`repository.start` upsert `update:{}` 原样复用 terminal failed 行，前端却弹"插图规划已启动"假成功。

### 实际修复

- dispatch：默认 `requestImage` 绑定改为显式占住 `fetchImpl` 位的 wrapper；新增"默认构造 + stub 全局 fetch"回归测试锁死参数位；tsconfig include 纳入 `server/text-to-image/**`（该域 `*.test.ts` 暂 exclude，测试由 vitest 把关），并修复纳入后暴露的 `provider-lane.repository.ts` 两处闭包收窄类型错误。
- 图片渲染：新增 `WorkspaceImage`（extend 官方 Image；renderHTML 展示层把相对 src 改写为 API URL，attrs.parseHTML 反向还原，markdown 序列化始终保留相对路径）；`imageSrcResolver` 从 `pages/index.vue` 闭包（含 user-assets 分支与 `%20` 先解码）穿透 Workbench→Studio→TipTap 编辑器；新增 `/api/workspace-files/image`（projectPath+相对路径，复用 read.get.ts 同款 resolve/open-guard/包含性校验链，404 固定文案不泄露绝对路径，`assets/text-to-image/` 前缀长缓存、其余 no-cache）；删除旧无守卫绝对路径路由。
- 重roll：`restoreAssetPlaceholder`（owner+lineage 校验 → 固定 seed 拒绝 → 与 Execution Compiler 同款管线预检 `sourceChapterHash` 漂移 → 章节锁内把 canonical 图片 Markdown 精确还原为 V2 placeholder → Job `sourceInsertStatus→missing`）；占位块状态服务对 failed/canceled/interrupted/succeeded+missing 回退 target 校验重新 ready（outcome_unknown 与 configuration_stale 保持冻结投影不放行）；资产详情"重新生成"对 illustration 走 restore→status 闸门→preview→generate 一键链；旧 Queue `cancel` 补 illustration 排除、retry 错误文案中文化。
- 迁移面板：`NovelTextToImagePanel` 回挂 `TextToImageCharacterMigrationPanel`，`character-visual-migration-ui-contract.test.ts` 6/6 转绿。
- Recipe 首开：`ensurePersistedDefault`（缺失才写、无效 fail-closed、并发首创冲突读回收敛）接入 plan 启动路由（有 `recipeMigrationModels` 迁移证据时跳过，保留显式迁移确认权）；前端 `loadRecipe` 对普通缺失自动落盘并加 latest-wins 票据；`isRecipeConflictError` 收紧为只认 `TEXT_TO_IMAGE_RECIPE_CONFLICT`；自动保存冲突不再无声丢草稿（通知后重读）。
- 失败出路：`service.start()` 对复用的 retryable failed/canceled 行自动 `repository.retry`（不可重试的 plan 校验失败原样返回）；index.vue 两个规划入口对终态返回弹 warning（含 errorMessage/staleReason）引导"重新规划"。

### 审查修正（5 视角 → 逐条对抗验证，19 报 15 实）

- P1×4 全部收口：固定 seed 重roll的 30 秒 lease 后必然 409（改为服务端在破坏性还原前按 Recipe seed 策略拒绝）；restore 先写后验导致章节编辑过即丢图片引用（改为还原前语义 hash 预检，漂移零写入）；服务端 ensure 抢先落盘会锁死 Recipe 迁移提案（加 recipeMigrationModels 闸门）；终态放行与冻结 UI 契约测试冲突（收回 outcome_unknown/configuration_stale，双侧测试对齐新合同并注释依据）。
- P2 收口：对话框重roll加 /status 闸门防叠加付费 Job；图片 Markdown 多处复制时拒绝还原（`asset_markdown_ambiguous`）；`replace` 第二参改 replacer 函数防 `$` 模式注入；404 文案不泄露路径；缓存分级；`%20` 双重编码；restore 路由补 `withProjectNotOpenHttpError`；store 冲突可见提示与 loadRecipe latest-wins。
- 同轮顺手修复上游合并遗留的预存损坏：7 个测试文件的 `writeProjectManifest` 旧 2 参签名、`resolveWorkspaceContainerRoot` 已删除引用、queue 夹具还在取 v2 `.style` 字段。

### 验证

- 聚焦回归：dispatch 5、recipe.service 11、placeholder 12、result（含 restore 漂移/删除/越权）12、queue 17、UI 契约（migration 6 + execution-ui 契约更新后全绿）等；全量 `bun run typecheck` exit 0（首次覆盖 text-to-image 生产代码）。
- 已知边界：outcome_unknown/configuration_stale 占位块仍无占位块级重发入口（出路是重新规划或修复配置后重新预览授权）；纯 localStorage 的 Recipe 迁移草稿在从未打开文生图分页、直接点正文生图的场景下会被服务端默认盘抢先（provider 迁移证据场景已保护）。

## 2026-07-27 Tag index 文件锁半截 JSON 时序竞争修复

### 现象与根因

- `bunx vitest run server/text-to-image/tag-index` 多文件并行时，约 1/4 概率在 tag-index-runtime.test.ts 的 duplicate clicks + cancel 用例抛出 `Tag index operation 文件锁损坏，拒绝抢占`（SyntaxError: Unexpected end of JSON input）；单独运行稳定通过。
- 根因在 `tag-index-store.ts` 的锁获取路径：`fs.open(lockPath, "wx")` 先创建**空**的 `.operation.lock`，再向句柄写入 JSON。并发的另一方在这个窗口内 EEXIST 后进入 `reclaimExpiredFileLock`，读到空/半截内容，JSON parse 失败即被判定为永久损坏并抛错。同进程并发即可触发，不需要跨进程；多文件并行只是放大了写入窗口。

### 系统性修复

- 写侧：锁创建改走既有 `writeTextAtomic(lockPath, ..., "create")`（同目录 temp + fsync 后 `fs.link` 原子发布，link 对已存在目标返回 EEXIST，create-only 互斥语义不变）。锁文件从此只会以完整内容原子出现，读端（reclaim/release）结构上不可能观察到半截 JSON。
- 读侧防御：`reclaimExpiredFileLock` 对 JSON parse/schema 失败不再抛"损坏，拒绝抢占"，改为与 EPERM/EACCES/EBUSY 相同的短锁争用语义（返回 false 退避），由外层 `lockMaxAttempts` 有界等待兜底；极端情况下退化为"等待文件锁超时"，仍是 fail-closed。文件系统层面的非预期读错误照旧抛出。

### 验证

- `bunx vitest run server/text-to-image/tag-index` 连续 21 次全绿（11 files / 42 tests）；按修复前约 1/4 的失败率，偶然全绿概率不足 0.3%。
- 既有用例 `reclaims only an expired short file lock` 写入的是完整过期锁，抢占语义不受影响；仓库内没有断言"损坏拒绝抢占"错误路径的测试，无需删改测试。

## 2026-07-22 Windows Desktop 客户端模块边界修复

### 现象与根因

- SQLite namespace 路径修复后的 Desktop 已能完成迁移并监听端口，但 WebView 显示 `Failed to fetch dynamically imported module`。
- 报错分块 HTTP 返回 200 且字节完整；raw CDP 也确认下载完成。真实失败发生在模块图解析：客户端分块含顶层 `import "node:crypto"`。
- `shared/text-to-image-contract-hash.ts` 被浏览器和服务端共同消费，却使用 Node `createHash()`；Vite 的 external 配置又把非法说明符原样保留到客户端产物。

### 系统性修复

- 合同 canonical JSON、同步 API 和 `sha256:<hex>` 输出均保持不变；底层改为 `@noble/hashes` 的跨运行时同步 SHA-256。
- 删除 `node:crypto` external。新增基于 `es-module-lexer` 的构建边界守卫，递归扫描 Nuxt 客户端 JavaScript，并在发现任意 `node:` 模块说明符时终止构建。
- 浏览器 bundle 红灯稳定复现 `Could not resolve "node:crypto"`；实现后共享合同聚焦测试 19 项通过。守卫对旧 `.output` 捕获 6 个真实违规分块，对新构建的 74 个客户端 JavaScript 文件扫描通过。

### 验证与计划偏差

- 本轮聚焦回归最终为 5 files、34 passed、1 skipped；全量 typecheck exit 0；完整 `bun run nuxt:build` exit 0。
- 原诊断一度怀疑 TCP ready 过早或静态大分块首取延迟；CDP 证明网络完整接收后仍拒绝 import，最终根因收敛为 Node built-in 泄漏。因此没有修改 Rust readiness 或缓存策略。
- 最终 Product stage exit 0（15 个 Profile 重编译并清理 30 个未引用产物）；Tauri release 编译 exit 0；最终 Desktop assemble exit 0。`dist` Product 边界扫描 74 个 JS 文件通过，portable Bun + `\\?\...\data` 迁移 exit 0；最终 EXE 启动后根页面 200、入口 `/_nuxt/C6oxnHZD.js` 200/291061 bytes。
- 按项目约束没有自动进行浏览器交互验收。服务级 smoke 结束时强制关闭 Tauri 没有触发其正常子进程清理，残留的 exact `dist/runtime/bun/bun.exe` PID 已核对路径后停止；最终 3618 listener 为 0，不属于产品运行错误。

## User Request

- 在网页前端新增“文生图”分页。
- 支持配置 NovelAI API。
- 支持保存、启用和切换多套画风串。
- 支持角色管理，角色包含中英文名称、性格年龄、外貌与 SFW/NSFW 身体 tag。
- 支持单独配置一个 LLM API 连接和模型。
- LLM 需要配置 Temperature、Top P、Max Tokens，Max Tokens 上限为 30000，支持滑动和手动输入。
- LLM 需要提供连接按钮，连接成功后读取服务返回的可用模型列表，并从该列表中选择模型；连接失败时显示“连接失败”。
- LLM 需要按任务维护提示词，任务包括正文图片生成、角色/服装设计、角色/服装修改，提示词可手动编辑或导入。
- 角色需要按当前小说分组，当前启用角色绑定当前创作小说。
- 新增角色支持手动添加，也支持从任意小说的角色设定导入，并调用 LLM 生成角色/服装 tag 草稿。
- 修复文生图分页没有独立滚动区域，底部内容无法点击的问题。
- 文生图分页中的各个配置区块需要支持折叠。
- 将正文生图的角色 tag 从旧酒馆式角色管理迁移为 Project Workspace 中的 Markdown 文件管理。
- `image-tags.md` 按角色中文别名、英文名、角色特征、正背面五官、SFW/NSFW 身体分区、负面提示词和服装列表维护。
- 正文生图只注入章节相关角色；通过专用子 agent 识别章节内相关角色，并把命中的角色 image-tags 注入 LLM 请求变量。
- 保留并结合现有提示词替换功能，不让旧角色/服装管理成为正文生图的必要入口。
- 在 Project Workspace 角色详情页右上方增加“生成角色 tag”按钮。
- 点击后先保存当前角色详情页，再通过子 agent 提取外貌信息，交给 LLM 生成 tag，并写入角色目录中的 `image-tags.md`。
- 角色目录结构约定为 `lorebook/character/<角色目录>/index.md` + `lorebook/character/<角色目录>/image-tags.md`；现有 `index.md` 目录不自动移动或改名。
- 每个角色可以绑定多件服装；`image-tags.md` 的服装列表只保存 `中文名称/英文名称` Markdown 链接索引，详细 Tag 独立保存在角色目录的 `outfits/*.md`。
- 独立服装文件按上半身、上半身背面、下半身、下半身背面四个部位维护。

## Goal

- 先完成文生图工作台的配置层、本地持久化状态、角色复用入口和 LLM 辅助生成人设 tag 的前端链路，为后续真实 NovelAI 生图请求、任务队列、结果保存留出结构。
- 本轮目标是把正文生图角色 tag 改为 `image-tags.md` 文件真相源，并建立“章节正文 -> 角色识别子 agent -> 只注入命中角色 tag -> 正文生图 LLM 变量”的链路。

## Current State

- IDE 左侧栏已有“文生图”入口。
- 文生图面板已挂入工具面板区域，并拥有独立滚动容器。
- NovelAI API、画风串、LLM 大模型和角色管理区块均支持展开/折叠。
- NovelAI、画风串、LLM、任务提示词和角色配置保存在 Pinia persisted state。
- 角色配置已从全局列表改为按 `projectPath` 分组；当前选中角色跟随当前小说切换。
- LLM 支持连接配置、连接按钮、可用模型列表读取、模型选择、Temperature、Top P、Max Tokens。
- LLM 任务提示词支持三类任务的手动编辑和本地 `.txt` / `.md` 文件导入。
- 从小说导入角色时，会读取来源 Project Workspace 的 `lorebook/character` 内容节点 `index.md`，并在存在 `state.md` 时一并读取，然后调用 OpenAI-compatible `/chat/completions` 接口生成字段化 tag 草稿。
- 正文生图已有 LLM 提示词生成 `<image>` 块、提示词替换和 NovelAI 请求链路；本轮已让正文生图请求变量包含 `characterImageTags`、`characterDetectorReport` 和 `promptRules`。
- 角色 image-tag 文件从 Project Workspace 的 `lorebook/**/image-tags.md` 递归读取；同一角色的中文别名用 `|` 或 `｜` 分隔，任一别名命中都可作为保底触发。
- 新增内置 profile `body-image.character-detector` 和 runtime skill `body-image-character-detection`，用于正文生图前从候选角色中筛选相关角色。
- 新增内置 profile `character-image-tag.extractor` 和 runtime skill `character-image-tag-generation`，用于角色详情页生成 `image-tags.md` 前提取生图相关外貌事实。
- Project Workspace 的角色详情页右上角已增加生成按钮；成功后会打开生成的 `image-tags.md` 文件分页。
- 角色 Tag 生成会同时读取 JSON `outfits[]` 或多个 `<服装>` 回复块，为当前角色写入独立服装 Markdown；同名服装更新，未返回服装保留，归属人不匹配的服装跳过并告警。
- 正文生图加载角色时会跟随服装索引读取独立文件，并按正背面与脸部/上半身/下半身/全身镜头确定性注入对应服装 Tag。
- 文生图面板不再展示旧角色/服装管理 UI；旧 Pinia store 和历史辅助函数暂留，避免本轮扩成大规模清理重构。

## Walkthrough

- 新增 `useTextToImageStore`，集中维护 NovelAI API、LLM 参数、任务提示词、画风串和按小说分组的角色配置。
- 重写 `NovelTextToImagePanel`，加入 LLM 参数滑条与数字输入、任务提示词选择/导入、角色手动添加和跨小说导入流程。
- 从来源小说导入角色时，前端通过 `/api/workspace-files/tree` 查找 `entryType === "character"` 的内容节点，并通过 `/api/workspace-files/read` 读取正文。
- LLM 角色设计调用目前使用浏览器直连 OpenAI-compatible API；如果目标 API 不允许 CORS，会在界面中提示失败并回退为导入原始文字设定。
- LLM 模型列表读取使用 OpenAI-compatible `/models` 接口；失败时清空旧模型列表并显示“连接失败”。
- `NovelIdeToolPanel` 的内容容器改为 flex 布局，使文生图面板内部滚动区域能获得正确高度。
- 文生图面板各区块标题栏增加折叠按钮，折叠状态为当前页面会话内状态，刷新后默认展开。
- 新增 `parseTextToImageCharacterImageTags` 解析 Markdown 分区，把 `image-tags.md` 转成正文生图可注入的结构化 tag。
- 新增 `/api/text-to-image/body-character-tags`，服务端读取当前 Project 的 `image-tags.md` 候选并调用 `body-image.character-detector` 子 agent；子 agent 失败时退回本地中文别名包含匹配。
- 正文生图构建 LLM 变量时并行收集本地 tag 词库和角色 image-tag 上下文，把命中角色渲染为 Markdown 注入 `characterImageTags`，同时保留 `characters` 兼容旧提示词变量。
- NovelAI 请求继续使用现有 `promptRules` 做提示词替换，但不再把旧 store 中的角色/服装数组传入正文生图路径。
- 任务默认 `bodyImage` 提示词已更新为读取 `currentChapter`、`characterImageTags`、`characterDetectorReport` 和 `tagData`，并要求直接展开命中角色英文 tags。
- 已编译 `body-image.character-detector` profile 到 `.compiled/artifacts`，catalog 可加载该内置 profile。
- 新增 `/api/text-to-image/character-image-tags`，接收当前角色详情页 Markdown、角色路径和文生图 LLM 配置；服务端调用 `character-image-tag.extractor` 提取外貌事实，再请求 OpenAI-compatible LLM 生成结构化角色 tag，最后渲染并写入 `image-tags.md`。
- 新增 `renderTextToImageCharacterImageTagsMarkdown`，保证生成的 `image-tags.md` 能被正文生图解析器回读。
- 角色详情页按钮会复用“角色/服装设计”的 LLM API 配置和任务提示词；如果配置缺失，会在前端提示用户先配置。
- 默认角色/服装设计提示词要求返回 `character + outfits[]` JSON；解析器同时消费既有提示词常用的 `<服装>` 标签格式，每个回复可包含多件服装。
- 生成服务在 `lorebook/character/<角色目录>/outfits/` 写入独立服装文件，并把显式相对链接合并回 `image-tags.md` 的服装列表。
- Prompt 编译器不再把服装英文名当作最终 Tag，而是按 resolver 给出的 `outfitName`、`view` 与 `framing` 选择服装文件中的对应部位。
- 已编译 `character-image-tag.extractor` profile 到 `.compiled/artifacts`，catalog 可加载该内置 profile。

- 新增 `body-image.prompt-placer` profile 与 `body-image-prompt-placement` skill：正文生图 LLM 仍按现有世界书返回 `<image>...</image>`，应用把解析出的图片 prompt 和章节段落交给插图定位子 agent，子 agent 只返回 `{promptId, afterParagraphId}`，不改写正文、不生成 tag。
- 新增 `/api/text-to-image/body-prompt-placements`：服务端复用/创建 `body-image.prompt-placer` session，规范化 placement，过滤未知 prompt、未知段落和重复结果；子 agent 调用失败时只使用明确 nearbyText 命中的段落兜底，避免无锚点图片被追加或均分到正文。
- `generateBodyImagesForCurrentChapter` 已改为“LLM 产 prompt -> placer agent 定位 -> 应用按段落 id 插入 `<text-to-image-prompt>`”链路，不再调用旧的无锚点分布插入路径。
- 旧 `insertTextToImagePromptPlaceholdersIntoMarkdown` 也已改为只插入能回贴正文上下文的 `<image>`，完全无锚点的 prompt 会跳过，避免未来误用时重新出现末尾追加/均分问题。
## Decisions

- 配置仍先存到 localStorage，避免在真实生图链路确定前扩展数据库或 workspace schema。
- 画风串同一时间只允许一个 active preset；删除 active preset 时自动切换到剩余第一项。
- 角色 active selection 按当前小说独立保存，方便同一角色名在不同小说中拥有不同 tag。
- NovelAI token 与 LLM API key 使用 password 输入框展示，但仍属于浏览器本地明文持久化，不应视为生产级密钥保护。
- LLM 调用先按 OpenAI-compatible chat completions 处理；后续如果需要支持更多 provider 或规避 CORS，应加服务端代理。
- LLM 模型列表先以 OpenAI-compatible `/models` 为默认合同，允许解析 `data` 或 `models` 两种常见返回字段。
- `image-tags.md` 作为角色生图 tag 的文件真相源，优先放在角色 lorebook 目录下；服务端递归读取 `lorebook/**/image-tags.md`，避免把旧面板状态作为正文生图合同。
- 角色识别子 agent 只能从候选 `image-tags.md` 中选择，不能自造角色；无模型、调用失败或无结构化结果时使用中文别名命中作为保底。
- `promptRules` 继续按现有提示词替换规则结构传递，包含 `id/name/enabled/target/matchMode/mode/trigger/replacement`，避免正文生图链路旁路已有替换系统。
- 角色详情页生成 tag 时不移动或重命名现有角色目录；如果来源已经是 `index.md` 内容节点，就在同目录生成 `image-tags.md`。
- `character-image-tag.extractor` 只提取外貌事实，不生成 NovelAI tags；tag 生成仍交给文生图 LLM，避免子 agent 同时承担分析和 prompt 工程两种职责。
- 服装归属于角色目录，不建立全局共享库；`image-tags.md` 只承担显式索引，独立服装 Markdown 是详细参数真相源。
- 同名服装重新生成时覆盖对应文件，本次 LLM 未返回的服装不删除，避免丢失用户手工维护内容。
- 服装部位选择由 Prompt 编译器确定，LLM 只返回服装名称与结构化 Tag，不能直接决定最终注入部位。
- 正文插图定位交给 `body-image.prompt-placer` 子 agent，但最终写入正文只由应用按 paragraph id 执行；无锚点结果宁可跳过，不再回退到章节末尾追加或按段落均分。

## Files Changed

- `app/stores/text-to-image.ts`
- `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`
- `app/components/novel-ide/NovelIdeToolPanel.vue`
- `app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue`
- `app/components/novel-ide/mock-data.ts`
- `app/components/novel-ide/NovelIdeSidebar.vue`
- `app/pages/index.vue`
- `app/utils/text-to-image-character-tags.ts`
- `app/utils/text-to-image-character-tags.test.ts`
- `app/utils/text-to-image-outfit-tags.ts`
- `app/utils/text-to-image-outfit-tags.test.ts`
- `app/utils/text-to-image-outfit-design.ts`
- `app/utils/text-to-image-outfit-design.test.ts`
- `server/text-to-image/body-image-character-tags.ts`
- `server/text-to-image/body-image-character-tags.test.ts`
- `server/text-to-image/body-image-prompt-placement.ts`
- `server/text-to-image/body-image-prompt-placement.test.ts`
- `server/text-to-image/character-image-tags.ts`
- `server/text-to-image/character-image-tags.test.ts`
- `server/text-to-image/prompt-compiler.ts`
- `server/text-to-image/prompt-compiler.test.ts`
- `server/api/text-to-image/body-character-tags.post.ts`
- `server/api/text-to-image/body-prompt-placements.post.ts`
- `server/api/text-to-image/character-image-tags.post.ts`
- `server/agent/profiles/builtin-contracts.ts`
- `server/agent/profiles/body-image-character-detector-profile.test.ts`
- `server/agent/profiles/body-image-prompt-placer-profile.test.ts`
- `server/agent/profiles/character-image-tag-extractor-profile.test.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/body-image.character-detector.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/body-image.prompt-placer.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/character-image-tag.extractor.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/.compiled/manifest.json`
- `assets/workspace/.nbook/agent/profiles/.compiled/artifacts/*`
- `assets/workspace/.nbook/agent/skills/body-image-character-detection/SKILL.md`
- `assets/workspace/.nbook/agent/skills/body-image-prompt-placement/SKILL.md`
- `assets/workspace/.nbook/agent/skills/character-image-tag-generation/SKILL.md`
- `PROJECT-STATUS.md`

## Verification

- 已运行 `bunx vitest run app/utils/text-to-image-outfit-tags.test.ts app/utils/text-to-image-outfit-design.test.ts app/utils/text-to-image-character-tags.test.ts server/text-to-image/character-image-tags.test.ts server/text-to-image/body-image-character-tags.test.ts server/text-to-image/prompt-compiler.test.ts`，结果 `6 files / 24 tests passed`。
- 已运行 `bun run typecheck`，Nuxt 类型检查退出码为 0。
- 新增回归覆盖两层路径边界：角色生成不会复用 `outfits/` 目录外的同名索引路径；`image-tags.md` 也不会解析跨角色、章节或其他目录的服装链接。

- 已运行 `bunx vitest run app/utils/text-to-image-character-tags.test.ts server/text-to-image/body-image-character-tags.test.ts server/agent/profiles/body-image-character-detector-profile.test.ts app/utils/text-to-image-llm.test.ts app/utils/text-to-image-prompt-engine.test.ts`，结果 5 files / 16 tests passed。
- 已运行 `bunx vitest run app/utils/text-to-image-character-tags.test.ts server/text-to-image/character-image-tags.test.ts server/agent/profiles/character-image-tag-extractor-profile.test.ts server/text-to-image/body-image-character-tags.test.ts server/agent/profiles/body-image-character-detector-profile.test.ts`，结果 5 files / 12 tests passed。
- 已运行 `bun scripts/build/profile.ts compile builtin/body-image.character-detector.profile.tsx --system`，生成内置 profile compiled artifact。
- 已运行 `bun scripts/build/profile.ts compile builtin/character-image-tag.extractor.profile.tsx --system`，生成内置 profile compiled artifact。
- 已运行 `bunx vitest run app/utils/text-to-image-llm.test.ts server/text-to-image/body-image-prompt-placement.test.ts server/agent/profiles/body-image-prompt-placer-profile.test.ts`，结果 3 files / 13 tests passed。
- 已运行 `bun scripts/build/profile.ts compile builtin/body-image.prompt-placer.profile.tsx --system`，生成内置 profile compiled artifact。
- 已再次运行 `bun run typecheck`；正文生图相关类型错误已清理，当前仍失败在既有 Plot 面板 `chapterPath/chapterId` 类型不一致：
  - `app/components/novel-ide/plot/NovelPlotPanel.vue`
- 按项目规则未自动做浏览器交互验收。

## 2026-07-11 Hard Cut Update

- Provider credentials, queue scheduling, retry, persisted jobs/assets, and the history workspace are now server-owned; the browser sends Provider IDs only.
- Body-image placeholders are structured Markdown contracts and are replaced under a chapter lock with ordinary Markdown image syntax after the first asset succeeds.
- The former `text-to-image-result` editor node, result dialogs, and visible Tavern-style role/outfit manager have been removed. Character image tags are managed only through the Project Workspace character directory and `image-tags.md`.
- The text-to-image panel creates manual jobs and shows queue summaries only. Users open generated assets through the dedicated history workspace tab.
- Current verification: focused LLM/chapter/queue suite passed (10 tests) and `bun run typecheck` passed after the hard cut.

## TODO / Follow-ups

- 增加文生图任务参数、队列状态、图片结果预览和保存。
- 为 LLM 角色 tag 设计增加服务端代理或 provider adapter，统一错误处理和密钥存储。
- 角色详情页已提供生成 `image-tags.md` 的轻量入口；后续仍可补手动创建模板和字段说明。
- 后续可以单独清理旧角色/服装 Pinia 状态和隐藏辅助函数；本轮只移除正文生图依赖和可见管理入口。
- 单独修复 `NovelPlotPanel.vue` 的 `chapterPath/chapterId` 类型不一致后，再把全仓 `bun run typecheck` 纳入文生图回归门禁。

## 2026-07-18 Route B 设置与配置真相源第一纵切

### 本轮需求与设计边界

- 依据已冻结设计 `docs/superpowers/specs/2026-07-17-ttp-storyboard-agent-illustration-design.md`，`illustration.director` 不再使用文生图模块私有的 OpenAI-compatible provider/model 作为配置真相。
- Director Agent Runtime binding 的唯一持久化位置收敛为 Workspace Root Global Config：`agent.profiles["illustration.director"].model.modelKey`。
- 全局“设置 → 模型配置”是唯一编辑与检测入口；文生图分页只读取摘要并跳转，不获得保存 Global Config 的能力。
- Project Config 禁止覆盖 Director model binding；该限制只针对 `model`，未来 project-scoped storyboard 等 `settings` 仍保留结构空间。
- NovelAI Provider/API、Recipe、采样与尺寸等生成参数、正负向画风串继续属于文生图域；本轮不向 Agent Profile、Skill、Storyboard 或正文按钮增加任何 NovelAI mutation DTO。
- 本轮不实现 TTP（text-to-picture）`tagData`，也不把旧正文生图 LLM 调用桥接成 Director；完整 planning operation 与旧链删除属于后续纵切。

### 现状差距

- Config 已支持 `agent.profiles.<key>.model.modelKey`，但 settings UI 只为已加载的物理 Profile 展示模型覆盖，尚无 `illustration.director` 用途卡。
- 文生图面板当前展示 `bodyImage` LLM Provider/model 摘要并打开独立工作台，容易被误认为 Director 的第二配置入口。
- Project Config 的通用 profile map 当前允许 Director model 覆盖，effective merge 也会消费该覆盖。
- NovelAI provider 数据库当前按 `(ownerUserId, name)` 唯一，并未结构性保证“每用户一个 NovelAI”；Recipe/画风串也仍存在浏览器持久化。这些是后续 P1 真相源迁移，不在本设置纵切内伪报完成。

### 分阶段实施计划

1. 先用 DTO、normalizer、Config Service 和 UI ownership 失败测试冻结 binding 合同与 Project 禁写边界。
2. 在共享 Config DTO 中增加 strict Director summary，由 Config Service 从 normalized effective config 解析；不新增第二个写 endpoint。
3. 在全局模型设置中增加 Director 模型选择、Provider 定位与复用现有模型检测的入口，并写回同一 Global Config profile slot。
4. 为 Settings Dialog 增加受控 Global/Models/Director 跳转；文生图分页只读 Config snapshot 并监听 config revision 刷新。
5. 运行聚焦测试、类型检查与代码审查；随后补充本节实际结果、计划偏差和验证记录。

详细步骤见 `docs/superpowers/plans/2026-07-18-route-b-settings-truth-source.md`。

### 当前状态

- 设置层第一纵切已实现并完成自动化验证；当前不代表 Route B、P1 或 P2 全量完成。

### 实际结果

- 新增稳定 `illustration.director` profile/binding 常量；Global Config 的 `agent.profiles["illustration.director"].model.modelKey` 成为唯一持久化 binding slot。
- `ConfigModelSettingsDto` 与内层 Director 摘要均为 strict；摘要只返回 configured、modelKey、Provider/model 标识与名称，不包含 secret、Recipe 或 NovelAI 参数。
- Config Service 只读取 Global 专用 slot 解析摘要；Director runtime 不继承 Global/Project 通用 Profile default model。Project DTO、保存服务与 normalizer 三层共同拒绝/剥离 Director model patch，同时保留未来 project-scoped settings/runtime。
- 全局“设置 → 模型配置”新增 Director 卡，可选择启用模型、定位 Provider、运行 Provider 连接测试和具体模型测试；dirty/save 与 Provider 删除清理都进入同一 Global Config 原子保存。
- 已保存 Provider ID 设为不可变；服务端在“masked secret 声称可保留、但当前 ID 无旧 secret”时返回 400，不再静默写空 API key。测试结果按完整草稿 fingerprint 关联，修改连接或模型草稿后不会继续展示旧成功状态。
- 文生图分页通过 Global editor snapshot 只读展示 Director 摘要，监听 Config revision 刷新，并经宿主受控跳转 Global/Models/Director；组件没有 Global Config 写函数。
- 通用 Agent Profile 模型面板对 Director model 显示只读说明；保存时保留 Global model 原值，Project 不产生 model patch，避免后续物理 Director Profile 加入 catalog 后自动形成第二写入口。
- 文生图辅助 LLM 工作区和 Pinia binding 已收窄为 `characterDesign` / `characterRevision`；恢复旧 localStorage 时会丢弃 `bodyImage` binding/prompt，不再保留隐藏正文 LLM 真相源。
- 完整 Director planning/Recipe 授权尚未实现，因此旧正文生图 toolbar 被禁用并显示明确原因，旧 placeholder 点击只给出局部通知；旧 `/api/text-to-image/body-prompts` route/service 已删除，Job create schema 拒绝新的 `kind="body"` 标量请求。文生图分页内的手动 NovelAI 生成不受影响。

### 计划偏差与原因

- 原计划把旧正文运行链保留到后续 P4；独立审查发现这会让老用户继续使用隐藏 localStorage binding、新用户进入无配置死路，并让正文按钮直接写 NovelAI 标量。为满足本轮权限边界，提前关闭了旧正文入口，但没有伪造 Director adapter 或兼容层。
- 原计划只处理 Director binding；审查发现 Provider ID 重命名会使脱敏 secret 静默丢失并直接破坏新 binding，因此追加了 UI 不可变约束与服务端 fail-closed 校验。
- Recipe Markdown、每用户 NovelAI singleton、Provider lane 与服务端 RecipeSnapshot 仍属于 Route B P1；当前数据库仍未完成 singleton/Recipe 真相源迁移，本轮不宣称这些目标已完成。

### 主要变更文件

- `shared/agent/illustration-director.ts`
- `shared/dto/config.dto.ts`
- `server/config/config-service.ts`
- `server/config/normalizer.ts`
- `app/components/novel-ide/settings/NovelIdeModelSettingsPanel.vue`
- `app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue`
- `app/components/novel-ide/NovelIdeSettingsDialog.vue`
- `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`
- `app/components/novel-ide/text-to-image/TextToImageLlmWorkspace.vue`
- `app/stores/text-to-image.ts`
- `app/utils/settings-navigation.ts`
- `app/pages/index.vue`
- `server/text-to-image/schemas.ts`
- 已删除 `server/api/text-to-image/body-prompts.post.ts` 与 `server/text-to-image/body-prompt.service.ts`。

### 验证

- 初始 Director RED：4 files，新增 7 tests 失败，既有 51 tests 通过。
- 显式 binding/default inheritance RED/GREEN：摘要与 runtime 均只读取 Global 专用 slot。
- 第二配置入口 RED/GREEN：旧 LLM workspace 的 `bodyImage` 编辑入口被合同测试命中并移除。
- 审查 P1 RED/GREEN：Provider masked-secret rename、恢复旧 body binding、正文 body Job 写入、正文旧 API/按钮四条边界均先失败后通过。
- 最终扩展回归：`10 files / 81 tests passed`，覆盖 DTO、normalizer、Config Service、UI ownership、Provider/model 检测端点、Pinia 辅助 LLM、LLM prompt、Job schema 与 queue。
- 最后一次 `bun run typecheck`：exit code 0。
- 按约束未自动运行浏览器验证；未提交、未推送、未发布。

### 后续边界

- P1 必须完成 NovelAI Provider 每用户 singleton、Recipe Markdown/RecipeSnapshot、Provider lane 与浏览器 Recipe/localStorage 硬切，之后正文按钮只能提交 shot/recipe 引用并由服务端编译授权。
- P2/P3 再加入物理 `illustration.director` Profile、Storyboard/Pattern 与 planning operations；本轮通用 Profile 面板 guard 已防止它成为第二 binding 写入口。
- Route B Director/Recipe 入口可用后，再重新开放正文 toolbar 与 placeholder 执行；不得恢复旧 completion/provider/context 链。

## 2026-07-19 Route B Recipe 真相源续作

### 本轮目标

- 把 Project Workspace `lorebook/instruction/text-to-image/default/index.md` 建成默认 NovelAI Recipe 的唯一持久化真相源。
- 用 strict Recipe source/snapshot codec 分离 `planningConstraintsHash` 与完整 `recipeSourceHash`。
- 手动 Job HTTP 不再接受 model、sampler、尺寸、seed、SMEA 或 style 正文；服务端读取 RecipeSnapshot 后编译并冻结执行输入。
- `novelAi` 与当前画风串退出 Pinia/localStorage 持久化，只保留页面加载态、草稿态和一次性迁移候选。
- 建立 NovelAI singleton 的 `0/1/many` preflight 与正式 API 边界；旧库存在多条时 fail-closed，不由程序猜选。

### 分期边界

冻结设计要求先让存在多条旧 NovelAI Provider 的用户显式选择，再应用 partial unique index。若现在直接新增唯一索引，SQLite migration 会在用户进入选择 UI 前失败。因此本纵切先完成 preflight、正式 singleton API 与 Recipe 真相源；重复记录确认、跨 Project 未完成 Job 状态迁移、partial unique index 和持久 15 秒 Provider lane 是紧邻后续纵切，不在本轮冒充完成。

详细步骤见 `docs/superpowers/plans/2026-07-19-route-b-recipe-truth-source.md`。

### 实际结果

- 新增 strict `TextToImageRecipeSource` / `TextToImageRecipeSnapshot` 与 canonical Markdown codec；默认真相源为 Project Workspace `lorebook/instruction/text-to-image/default/index.md`，完整 source 与规划画幅分别使用 `recipeSourceHash` / `planningConstraintsHash`。
- Recipe GET 缺失时只返回未持久化默认草稿；PUT 是文生图分页的唯一 Recipe API 写入口，进入 Project open guard、tracked write 与 index invalidation。相同 Project 的重读、expected hash 检查和写入在同一临界区，两个并发 PUT 不会同时成功。
- 无效 YAML/content-node/schema/capability 不再泛化为 500 或回退缺失：统一返回 422 `TEXT_TO_IMAGE_RECIPE_INVALID` 和原文件 SHA-256；页面以默认修复草稿继续可用，但只有携带该 hash 的显式 PUT 才可覆盖，文件已变化则冲突。
- 手动 Job HTTP 只接受 `projectPath/providerId/kind=manual/prompt/negativePrompt/count/recipeId/expectedRecipeSourceHash`。model、sampler、scheduler、guidance、尺寸、seed、SMEA 和 style 均由服务端从已保存 Recipe 编译。
- Queue 的 `requestJson` 保存完整 RecipeSnapshot、Recipe style 和编译后的 NovelAI 参数；入队与 worker 读取都会重算 snapshot hash 并比对执行参数，未来内部入口也不能伪造 model/采样/尺寸/画风。
- random seed policy 在 Job 创建时解析为一次具体 seed；RecipeSnapshot 继续保存 policy，同一 Job 的自动 retry 复用持久值，adapter 不再对该 Job 重抽。
- Provider DTO 已按 kind 分流：NovelAI 不含 model，OpenAI-compatible 保留 model。Queue 只从 singleton Provider 解封 credential/读取限速，不允许 Provider 覆盖 Recipe 图片模型。
- NovelAI 正式入口为 singleton GET/PUT/test；普通 collection POST/PATCH 不能创建或修改 NovelAI。`0/1/many` inspection、同 ID 更新和 worker credential resolution 均在多条旧记录时 fail-closed。
- singleton PUT 增加 owner 级原子写锁，两个并发首次保存只产生一条记录。SQLite schema 把 NovelAI `model` 改为空，并把迁移前旧实际 model 转存到只用于 Recipe migration preflight 的 `recipeMigrationModel` evidence。
- 文生图 store 不再持久化 `novelAi/stylePresets/activeStyleId`；页面按 Project 加载/保存 Recipe。旧 localStorage 值只形成一次性未保存 proposal，保存成功后清理相关字段。
- 旧浏览器 model 与旧 Provider 实际 model 冲突时，页面明确列出候选并阻止保存，直到用户选择；localStorage 缺失而只有一个旧实际 model 时，用它形成待确认 Recipe proposal，避免静默回退默认模型。
- 文生图分页继续独占 NovelAI API 与 Recipe 编辑。Director binding 仍为只读摘要/跳转；Agent Profile、Skill、Storyboard 和正文按钮没有新增 Recipe/NovelAI 写 DTO。
- NovelAI V4 只显示 SMEA auto/off 并禁用 Dyn，服务端拒绝 V4 手动 SMEA/Dyn；V3 才允许并实际发送 `sm/sm_dyn`。旧的浏览器 NovelAI debug snapshot 与死请求摘要已从页面和 persisted pick 移除。

### 独立审查与计划偏差

- 独立只读审查没有 P0，提出 6 个 P1：旧实际模型迁移会丢失、Recipe expected hash 非原子、singleton 首次创建竞态、random seed retry 漂移、无效 Recipe 缺少稳定错误/修复出口、V4 SMEA UI 与 payload 不一致；另有 1 个 P2 stale browser debug 伪真相源。
- 原计划只实现顺序 singleton preflight；为消除新重复记录竞态，本轮追加 owner 级写锁。partial unique index 仍不能在旧重复数据 reconciliation 前创建，未冒充数据库级最终唯一约束。
- 原计划只读浏览器迁移草稿；核对旧执行链后确认 Provider.model 才是实际模型，因此追加 migration evidence、无 localStorage 迁移和冲突选择 UI。
- 原计划把 random policy 以 `-1` 交给 adapter；审查证明 retry 会改变同一 Job 请求，因此改为 Job 创建时冻结具体 seed。
- 以上审查项均已实现并补聚焦测试；没有用 compatibility adapter、localStorage 双真相或 Provider.model 回退修补。

### 主要变更文件

- Recipe/schema/codec/service：`shared/text-to-image-recipe.ts`、`server/text-to-image/recipe.codec.ts`、`server/text-to-image/recipe.service.ts`、`server/text-to-image/recipe-http-error.ts`。
- HTTP/执行：`server/api/text-to-image/recipes/default.*`、`server/api/text-to-image/jobs/index.post.ts`、`server/text-to-image/schemas.ts`、`server/text-to-image/queue.service.ts`、`server/text-to-image/novelai-image-generation.ts`。
- singleton Provider：`shared/dto/text-to-image.dto.ts`、`server/text-to-image/provider.service.ts`、`server/api/text-to-image/providers/novelai.*`、`server/api/text-to-image/providers/index.post.ts`。
- 数据库：`prisma/schema.prisma`、`prisma/schema.sqlite.prisma`、`prisma/migrations/sqlite/20260719100000_novelai_recipe_model_ownership/migration.sql` 与重新生成的 Prisma client。
- 页面与迁移：`app/utils/text-to-image-recipe-migration.ts`、`app/stores/text-to-image.ts`、`app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`、`app/components/novel-ide/text-to-image/TextToImageProviderSection.vue`、`app/components/novel-ide/text-to-image/TextToImageLlmWorkspace.vue`。
- 聚焦测试：Recipe codec/service、Provider、Job schema、Queue、NovelAI adapter、migration/store 与 settings security contract 测试。

### 验证

- 审查修复 RED：5 files 中 10 项按预期失败，覆盖迁移模型、两个并发竞态、random seed、invalid Recipe 与 SMEA。
- 审查修复轻量 GREEN：`4 files / 28 tests passed`。
- Queue 独立验证：`1 file / 8 tests passed`，包含 retry 使用同一具体 seed 与内部 snapshot 防伪。
- 最终轻量回归：`8 files / 46 tests passed`，覆盖 codec、service、Provider、adapter、schema、migration、store 与静态安全合同。
- `bun run generate` 成功生成 Prisma Client 7.3.0。
- `bun run typecheck`：首轮只发现本轮 Vue `ComputedRef` 访问错误；修复后完整 Nuxt typecheck exit code 0。
- 静态搜索确认：公共 Job schema/handler 无 NovelAI 标量，页面无 stale `lastNovelAiExchange/lastGenerationRequest`，persisted pick 无 Recipe 副本，NovelAI Queue 无 Provider.model override。
- 按项目规则未自动做浏览器交互验收；未修改 Git index，未提交、未推送、未发布。

### 后续边界

- 增加 credentialRevision，并使旧 revision queued Job fail-closed。
- 把当前 Project/provider 进程内 Queue lane 升级为应用数据库持久化、跨 Project 的 `(ownerUserId, providerId)` 15 秒 lane。
- Execution Preview/Manifest、Director planning/Storyboard/Pattern 与正文按钮引用编译仍属于后续纵切；不得恢复旧 completion/provider/context 链。

## 2026-07-19 Route B NovelAI Provider reconciliation 续作

### 本轮目标

- 对历史上同一用户的多条 NovelAI Provider 做一次性显式收敛；不按时间、名称或 ID 自动猜选。
- 在删除 Provider 前处理所有可发现 Project SQLite 中绑定丢弃配置的旧未完成 Job，并保留完成记录的脱敏 Provider 证据。
- 迁移期立即阻止产生新重复；所有 owner 收敛后安装精确 partial unique index。
- 多条候选或恢复决定未完成时，保存、测试、enqueue、retry 与 worker 全部 fail-closed。

详细步骤见 `docs/superpowers/plans/2026-07-19-route-b-provider-reconciliation.md`。

### 实际结果

- inspection 现在返回 `0/1/many`、绑定 owner 与完整候选记录的 SHA-256 `selectionToken`，以及仅在跨库恢复时出现的 `reconciliationKeepProviderId`；DTO 永不返回 credential/ciphertext。
- 文生图分页只显示脱敏 radio 候选并要求二次确认。首次 Project 处理失败后，页面锁定 App DB 中已持久化的原选择，只能继续恢复同一 `keepProviderId + selectionToken`，不能改选。
- App DB 新增 owner-scoped `TextToImageProviderReconciliation` saga。在任何 Project mutation 前以短 owner 写事务写入选择；Project 逐库幂等提交后，再用第二个短事务复验候选集合/token、规范化保留 Provider、删除丢弃项、最终化约束并删除 saga。
- Project 扫描直接发现 Workspace 容器下一层的 `.nbook/project.sqlite`，不依赖有效 `project.yaml`；损坏或缺失 manifest 但数据库仍存在的 Project 不会被跳过。
- 丢弃 Provider 的 `queued` Job 转为 `configuration_stale`，`running` 转为 `outcome_unknown`，且不进入自动 retry。旧 Project 会幂等补 `providerSnapshotJson`；所有相关 Job（包括已完成记录）在 Provider 删除前补入含 `ownerUserId`、不含密钥的不可变 Provider snapshot，新 Job 创建时也直接冻结该审计证据。
- Queue 用条件更新领取 `queued/running -> running`；远端响应返回后必须 CAS `running -> completing` 才能写 Asset，取消也只允许 CAS `queued/running -> canceled`，不会覆盖 `outcome_unknown` 或 `completing`。多图保存中途失败会反向补偿删除已保存资产；补偿失败的资产 ID 保留在 failed Job，最终成功 CAS 也检查 affected count。
- enqueue 与 retry 在写 Project Job 前执行 owner-scoped singleton preflight；未收敛时返回稳定 `TEXT_TO_IMAGE_PROVIDER_SELECTION_REQUIRED`，无 Provider 或缺完整 sealed credential 时返回 `TEXT_TO_IMAGE_PROVIDER_NOT_CONFIGURED`，都不会先落一条泛化 failed Job。NovelAI PUT、连接/模型测试和 Job API 共享同一 Provider HTTP mapper；UI 保存、测试、生成与历史重试统一以 `hasCredential` 派生的 ready Provider 为准。
- NovelAI 执行边界无条件使用 `max(15000, configured)`；reconciliation 同时把保留的旧 `0ms` 配置规范化为 15 秒。跨 Project 的持久 lane 仍按冻结设计留到下一纵切。
- SQLite migration 先安装 INSERT/UPDATE transition trigger，在保留旧重复数据可启动的同时阻止新增重复。最后一个 owner 收敛后创建精确 `one_novelai_provider_per_owner` partial unique，并删除 trigger；同名索引定义不精确时 fail-closed。
- `activeNovelAiProviderId` 不再进入 localStorage，也不再可手工选择；它完全由服务端 inspection 派生。`outcome_unknown` 在历史 UI 使用 danger/unknown 语义。
- 真实双 Prisma client 测试发现 SQLite 写锁争用会直接返回 `SQLITE_BUSY`；owner mutation 现在只承载短 App-only 事务，并做有界指数退避。跨 Project 副作用不在可重放事务内。

### 独立审查与计划偏差

- 首轮独立审查判定原实现 Not Ready：1 个 P0（Project 1 已提交、Project 2 失败后系统遗忘选择，可改选并损坏 Job）和多项 P1（Queue check/write、Asset 写入竞态、0ms 间隔、worker 入口仍可落 Job、缺真实 SQLite 并发测试）。
- 原计划用一个 App owner 事务包住 Project 扫描；App DB 与多个 Project SQLite 不能形成原子事务，因此改为“持久 saga + Project fail-forward + 两段短 App 事务”。
- 原计划只阻止晚到响应覆盖 Job 终态；审查证明状态检查与首张 Asset 写入之间仍有窗口，因此追加持久 `completing` 完成权 CAS。
- 原计划只处理未完成 Job 状态；冻结设计还要求删除 Provider 后保留历史证据，因此追加脱敏 `providerSnapshotJson` 与旧 Project 幂等补列。
- 真实 SQLite 集成测试额外暴露多 client `SQLITE_BUSY`；修复落在 owner mutation 抽象中，没有退回进程内锁或放宽数据库约束。
- 第二轮独立审查提出 cancel 非 CAS、缺 token 预检/错误出口、snapshot 缺 owner 证据与 `completing` 部分资产四项 P1；补齐后同一审查者最终判定当前 reconciliation 第一纵切 Ready，未发现新 P0/P1。

### 主要变更文件

- Provider/saga/API：`shared/dto/text-to-image.dto.ts`、`server/text-to-image/provider.service.ts`、`server/text-to-image/provider-http-error.ts`、`server/api/text-to-image/providers/novelai/reconcile.post.ts`。
- Project/Queue：`server/text-to-image/provider-reconciliation.service.ts`、`server/text-to-image/queue.service.ts`、`server/workspace-files/project-workspace.ts`、Job create/retry/list API。
- 数据库：`prisma/schema.prisma`、`prisma/schema.sqlite.prisma`、`prisma/project.schema.prisma`、`prisma/migrations/sqlite/20260719140000_novelai_provider_singleton_transition/migration.sql`、`scripts/db/sqlite-migrate.mjs`。
- UI：`NovelAiProviderReconciliation.vue`、`NovelTextToImagePanel.vue`、`TextToImageHistoryWorkspace.vue`、`TextToImageAssetDetailDialog.vue`、`app/stores/text-to-image.ts`。
- 测试：Provider 内存/真实 SQLite、Project reconciliation、Queue CAS、SQL trigger/index splitter 与 Project migration 测试。

### 验证

- TDD RED：新增 8 项按预期失败，覆盖跨库改选、Provider snapshot、queued claim、非空晚到响应、`completing` 完成权、未收敛 enqueue/retry 和 15 秒下限。
- Prisma generate：App 与 Project Prisma Client 7.3.0 均生成成功。
- 最终聚焦回归：`6 files / 44 tests passed`，包括两个真实 App SQLite/Prisma client 的并发首次 PUT、saga 持久化、cancel 两类受控竞态、缺 token 入口、Provider owner snapshot 与多图部分失败补偿。
- `bun run typecheck`：完整 Nuxt typecheck exit code 0。
- 按项目规则未自动进行浏览器验证；未提交、未推送、未发布。

### 后续边界

- 增加 `credentialRevision`，并让旧 revision 的 queued Job 明确进入配置过期终态。
- 把当前进程内 lane 升级为 App DB 持久化、跨 Project 的 `(ownerUserId, providerId)` 15 秒 lane；本轮只保证执行边界最低间隔，不宣称多进程持久限速。
- 用持久 attempt lease/fence 约束多 coordinator 领取，并一并收口重启时 `running/completing` 的付费不确定性；当前单进程 lane 不是跨进程幂等保证。
- saga 恢复完成通知应累计此前已提交 Project 的 impact；另补一条真实重复数据到最终 partial unique/saga 清理的全链路集成测试。
- 所有历史 owner 完成硬切并确认无需恢复后，删除一次性 reconciliation API/UI/saga 表与 transition 代码，不保留多 Provider compatibility adapter。
- Director planning、Storyboard/Pattern、Execution Manifest 与正文引用编译仍属于后续纵切；正文旧链不得重新开放。

## 2026-07-19 Route B P0 合同基础与 session 并发安全（已完成，终审 Ready）

### 现状核对

- 已按冻结规格 §§7–8、11.6–11.8、19、21、22、25 逐项审计当前代码。现有实现只有 Director binding 常量、Recipe/singleton/Queue 基线；Storyboard Preset、Tag Pattern、两类 overlay、SemanticTagResolution、Markdown codec、领域 resolver、Director 物理 Profile/Skill 与 planning workflow 尚未建立。
- `shared/text-to-image-markdown.ts` 仍是保存完整 prompt 的 V1 placeholder；旧 detector/placer/completion API/Profile/Skill 仍存在。它们只在 P4 替代链完成后硬切，本阶段不建立兼容 adapter，也不提前恢复正文入口。
- `JsonlSessionRepository.nextSessionId()` 当前对 `session-seq.json` 做无锁 read-modify-write；并发顶层 session 可分配同一 ID 并覆盖同一 JSONL，属于规格 P0 必须先修复的系统竞态。

### 分阶段实施计划

1. 建立共享 canonical hash 与三类 terminal `SemanticTagResolution` 严格合同。
2. 建立 Storyboard Preset/Overlay 七类规则合同、状态与 semantic/diagnostic hash。
3. 建立 Tag Pattern/Overlay 合同、引用所有权校验与 planning/render hash 分域。
4. 建立拒绝重复 key/anchor/alias/merge/custom tag 的 Markdown codec。
5. 建立 fail-closed overlay 与 companion pair resolver。
6. 以聚焦并发 RED 修复 Agent session 创建临界区。
7. 跑聚焦回归与 typecheck，记录实际偏差后再进入 P2 import/publish/migration。

详细计划：`docs/superpowers/plans/2026-07-19-route-b-p0-contract-foundation.md`。

### 不在本纵切冒充完成的范围

- TTP import API/UI、global publish journal、Project 编辑器、角色/服装迁移、Danbooru 同步/索引、Director planning、V2 placeholder、Execution Manifest、持久 Provider lane、P5/P6 均仍是后续阶段。
- 不实现或预留 TTP `tagData/` 下载、导入、解密、enrichment 或 adapter。
- 按项目规则不自动运行浏览器验证；不提交、推送或发布。

### 实际结果

- 新增 `SemanticTagResolution` V1 严格终态合同：canonical exact/alias、可靠 replacement、受控 `provider_passthrough` 三分支；`modelScope` 硬切为 `generic-novelai | novelai-model + modelId`，override rank/actor/reason/approval evidence 与 `resolvedAt` hash 排除均由类型和 refinement 约束。
- passthrough 对 `NFKC(sourceText)` 做安全校验并现场复算 `validationTextHash`；拒绝控制字符、逗号嵌套、权重/宏/参数、XML 与 Markdown，同时 `wireText` 仍只裁剪原文首尾 ASCII 空格，合法内部下划线不被改写。
- 新增 Storyboard Preset/Overlay 七类 strict rule 合同、semantic/diagnostic hash 与批准状态；blocking risk/macro 只能 pending，TTP 批准 envelope 独立冻结 raw/sanitized source hash，来源漂移不污染 semantic hash 但会使状态 stale。
- 新增 Tag Pattern Set/Overlay strict 合同、同 Pattern resolution ref 所有权校验、planning/render 双 hash；disable/identity/operation kind 不污染 render 域，互不冲突 operation 的物理顺序经 canonical sort 不制造假 stale。
- 新增 Storyboard/Pattern Markdown codec；YAML duplicate key、anchor、alias、merge、warning、全部显式 tag 与 strict schema 未知字段均 fail-closed，正文只影响 fileHash。
- 新增两类领域 resolver：replace/disable/append 只做整条增量覆盖，stale/conflict 返回未修改 approved base；Effective Preset hash 覆盖 enabled/matching/defaults/macros/稳定 rules，Pattern 输出 base/project + operation + sourceEntryId provenance；companion pair 缺失或身份不一致 fail-closed。
- canonical contract hash 公共边界同时以 TypeScript 与运行时限制为 plain JSON value，拒绝 Date、class、undefined、非有限数和稀疏数组，不再使用 `object + assertion` 绕过类型系统。
- Agent session 创建临界区升级为同进程、同真实 root 的共享 tail；root 使用 realpath 与 Windows case normalization。sequence 缺失/损坏时按已有数字 JSONL 最大 ID 恢复，非文件占位与安全整数上限 fail-closed；header 使用 `wx`，stale sequence 碰撞只重新分配，不覆盖历史 JSONL。

### 独立审查与计划偏差

- 首轮独立审查为 `Not Ready`，提出 10 个 Important：blocking/source provenance、passthrough/YAML、冻结 DTO、hash 分域、effective hash、Pattern provenance、session 恢复和 generic hash 类型边界。全部按冻结规格逐项 RED/GREEN 修正。
- 第二轮只余 Markdown deny boundary 与 unsafe sequence 两项 Important，并建议 render operation canonical sort；全部修正。第三轮继续发现行内下划线 emphasis/horizontal rule 残余；追加边界感知校验并保留合法 `soft_blue_haze` 后，最终审查判定 `Ready`，无遗留 P0/P1。
- 原计划只把 session 修复到共享 creation tail；审查证明 sequence 损坏、root alias、已有 JSONL 和非安全整数仍可造成覆盖或 livelock，因此扩展为完整 fail-closed allocator 边界。这是系统性补强，不是 scheduler/兼容 hack。
- 原计划没有明确 approved source provenance 的存放位置；实现选择在 review envelope 独立冻结 raw/sanitized hash，从而保持 semantic/planning/render hash 分域不被来源信息污染。
- 本阶段没有 Prisma schema 变化，因此用户虽已授权 Prisma generate，本轮无需运行；没有制造无意义生成差异。

### 主要变更文件

- Shared contracts：`shared/text-to-image-contract-hash.ts`、`shared/text-to-image-tag-resolution.ts`、`shared/text-to-image-storyboard-preset.ts`、`shared/text-to-image-tag-pattern.ts` 及对应测试。
- Markdown/resolver：`server/text-to-image/strict-frontmatter.ts`、`storyboard-preset.codec.ts`、`tag-pattern.codec.ts`、`storyboard-rule-resolver.ts`、`tag-pattern-resolver.ts` 及对应测试。
- Session：`server/agent/session/session-repo.ts`、`server/agent/session/session-repo.test.ts`。

### 验证

- Session 初始 RED 稳定复现 32 个并发创建重复 ID；24 个同 root repository 实例再次复现跨实例重复。
- 审查修正均先有聚焦 RED，再最小 GREEN；最终 P0 组合回归 `8 files / 55 tests passed`。
- 完整 `bun run typecheck` 最终 exit code 0；中间严格 JSON 类型收紧实际捕获了 4 个宽泛 `object` Pattern hash 投影，已改为字段级 typed projection 后转绿。
- 独立只读终审最终判定 `Ready`，无遗留 P0/P1。
- 按约束未自动运行浏览器验证；未提交、未推送、未发布，也未改动 Git index。

### 后续边界

- 下一纵切按 `docs/superpowers/plans/2026-07-19-route-b-p2-import-foundation.md` 实现确定性 TTP inspect、secret redaction、七类 classifier 与不可批准的 `pending_unresolved` companion/report。
- Danbooru active index、terminal Resolver、approve/global publish、Project overlay 编辑器、角色/服装 V2 migration 仍需在 P2 后续切片完成；不得用 mock index 或自由 Tag 绕过。

## 2026-07-19 Route B P2 确定性导入第一纵切（pending_unresolved）

### 本轮目标与硬边界

- 把旧前端宽松 ST JSON 导入入口硬切为 server/shared 的确定性 TTP Storyboard inspect 与 Director convert 流程。
- 只接受当前已打开 Project Workspace 顶层 `upload/*.json`，最大 16 MiB；不递归扫描 Project，不读取 TTP `tagData`，不把外部 role/instruction 变成权限。
- 本轮只产出可审查但不可批准的 `pending_unresolved` Storyboard + Tag Pattern companion、只读 Recipe proposal 与 global archive/journal；不伪造 active Tag index，不发布 selector。
- NovelAI Provider/API、Recipe 与生成参数仍只属于文生图域；Profile、Skill、Storyboard、导入 API 和正文按钮均无写权限。

### 实际结果

- 新增 strict import DTO/state/report、PendingTagAtom 与 UI preview schema；`pending_unresolved -> publishing` 在状态机和 UI 都不可达。
- 新增原始 bytes strict JSON reader：UTF-8、16 MiB、duplicate key、prototype pollution key、深度/entry/字符串/安全整数限制、direct entries/单 wrapper shape 与 canonical secret redaction 全部 fail-closed。
- 新增七类 deterministic inspector，保留稳定 source identity、sourceOrder/JSON Pointer、enabled/role/trigger、未知字段与安全标记；Director chunks 固定 64 entries / 80k chars，不把 disabled、角色/服装、输出模板、越权声明或 blocking 宏内容交给 conversion。
- 新增 strict Director conversion output 与服务端 candidate builder。Agent 不能提交最终 ID、Prompt、terminal resolution、Provider/Recipe 或生成参数；ruleId/patternId 只由 sourceEntryId + kind + 注册 semanticSlot 派生。
- 每份可解析 JSON 都成对产生 candidates；无可用规则写 `NO_USABLE_STORYBOARD_RULE` blocking，Pattern 为空不单独阻断。PendingTagAtom 无法通过正式 Tag Pattern schema。
- companion identity 使用两阶段内容寻址：先由 Storyboard semanticHash、Pattern planning/render hashes 与 diagnosticHash 计算 `candidatePackageHash`，再派生共享 `packageId/resourceKey`；身份不反向进入任一内容 hash。
- Recipe proposal 不进入 companion identity，使用独立 `recipeProposalHash`；相同 import/converter 下任一 proposal 漂移仍由 journal 报 `STORYBOARD_IMPORT_CONVERSION_CONFLICT`。
- 新增全局 Profile Home archive 与可重放 journal：`source.sanitized.json`、`inspect.json`、两份 candidate Markdown、`report.md`、`journal.json`；raw secret 永不落盘，create-only 工件冲突、原 upload 改变/删除、journal 漂移均有稳定错误出口，且不会修改当前 approved selector。
- 新增物理 `illustration.director` Profile、固定 `novel-import-ttp-storyboard-preset` Skill 与 inspect/submit 两项窄工具。工具通过全局 runtime registry 注册，Profile 只用 `pluginTool` 显式绑定；无 shell、通用文件、网络、Provider/Recipe 或图片生成参数权限。
- Global Profile Home 初始化同 package identity 的安全默认 Storyboard 与空 approved Pattern companion。Profile Settings 保留 typed `chapterPlanPolicy` 单一对象默认值；因 Low-Code Form 首版只支持顶层 field path，当前 UI 只展示 `storyboardPresetKey` 与 `planningConcurrency`。
- 文生图分页新增专用导入组件：列出 Project `upload/` 顶层 JSON，显示七类统计、enabled/disabled、宏分类与 blocking、脱敏路径、chunk 数和 `TAG_INDEX_NOT_READY`；转换复用 canonical Agent session API，完成后从 preview API 复验并展示两份 pending Markdown、hash 与只读 Recipe proposal。
- 批准按钮固定禁用，不存在“上传即激活”。组件没有 localStorage、Provider/Recipe endpoint 或 candidate 保存逻辑；旧 `parseStTtpTextToImageSettings`、native file input 与 Pinia 写入已从宿主断开。

### 错误出口与恢复

- Path/source：`STORYBOARD_IMPORT_PATH_INVALID`、`SOURCE_NOT_FOUND`、`SOURCE_NOT_FILE`、`SOURCE_OUTSIDE_UPLOAD`、`SOURCE_CHANGED`。
- Parser：文件过大、UTF-8/JSON/duplicate/unsafe key/depth/string/number/entry/shape 错误均保留稳定 `STORYBOARD_IMPORT_*` code；HTTP 映射为 400/413。
- Archive/conversion：`ARCHIVE_NOT_FOUND`、`PREVIEW_NOT_READY`、`JOURNAL_INVALID`、`ARCHIVE_CONFLICT`、`CONVERSION_CONFLICT` 映射为 404/409；失败不切 selector，可按同 import/version 幂等重放。
- UI 表单/加载错误保持局部可见；转换成功使用全局通知。未配置 Director 时只跳转 Global Models，不在本页创建第二 binding。

### 计划偏差与审查修正

- 原计划把 Recipe proposal 纳入 `candidatePackageHash`；冻结规格只允许 Storyboard semantic、Pattern planning/render 与 diagnostics 组成 companion hash，因此改为独立 `recipeProposalHash`，同时保留同 converterVersion 漂移检测。
- 初版候选先以 `importId+presetId` 派生 package identity，审计后确认违背“hash 先于 identity”；已追加 RED/GREEN 改为两阶段内容寻址，并让 pending Pattern/package envelope 显式携带同一 `resourceKey`。
- Profile 初版直接绑定 self-contained tool definition，编译会把 Prisma/libsql native 依赖拉入 artifact；系统性改为全局 runtime registry + Profile `pluginTool`，不是编译兼容 hack。
- Task 7 没有创建第二个专用 Agent orchestration endpoint；source/inspect/preview 使用文生图 API，模型执行复用现有 Agent session/invocation 真相源。
- 旧 `app/utils/text-to-image-st-ttp-import.ts` 已无 UI 消费者，但角色/服装 V2 migration 尚未接管其剩余语义，按计划暂不删除，也不建立 adapter。

### 验证

- 所有复杂边界均先有聚焦 RED：缺模块、包身份顺序、Recipe proposal 漂移、旧浏览器 importer、preview 不可批准与 fs overload 均实际失败后再修正。
- P2 最终组合回归：`13 files / 57 tests passed`（最终文档后复跑确认）。
- `bun run typecheck`：最终 exit code 0；中间捕获并修正 Node `fs.readdir` Buffer overload 误选。
- `illustration.director` Profile 编译成功，status=`loaded`，artifact=`a344561930b945bdd13a343d7d67680649629dca5954cc206a74bda322e4a5fe.mjs`。
- 新 API/UI/Profile/Skill/服务静态搜索：`tagData`、localStorage/旧 browser importer、Provider/Recipe endpoint、sampler/scheduler/steps/guidance/seed/SMEA 均零命中。
- 本纵切无 Prisma schema 变化，因此未重复运行 Prisma generate。按约束未自动运行浏览器验证；未提交、未推送、未发布，也未操作既有暂存设计文档。

### 后续边界

- 当前只完成 P2 deterministic import foundation，不代表 P2 或 Route B 完成。
- 下一批仍需官方 Danbooru 同步/四层 active index、TagPolicy/terminal Resolver、resolved candidate diff、global publish selector journal、Project overlay editor 与角色/服装 V2 migration。
- active Tag index 就绪前不得开放 approve/publish，不得以自由 Tag、mock index、TTP `tagData` 或浏览器缓存绕过。

## 2026-07-20 Route B P2 官方 Tag index / Policy / Resolver 续作

### 实施前差距与冻结边界

- 当前 import foundation 只能产出 `pending_unresolved`；仓库尚无官方 Danbooru SourceClient、watermark/reconciliation、四层工件、SQLite FTS active pointer、独立 TagPolicyRegistry 或终态 Resolver service。
- 官方源码复核确认 JSON controller 统一走 `paginated_search`，ID sequential pagination 使用 `page=a<ID>`；live API 无 snapshot isolation，因此 NeuroBook 必须本地冻结 upper watermark并做第二轮 reconciliation，不能以一次页码抓取冒充完整。
- 新实现只接受固定 `https://danbooru.donmai.us` 官方域，固定 inclusive 3K 阈值；不建立通用 source adapter，不下载/导入/解密 TTP `tagData`，不引入 embedding/sqlite-vec。
- Tag index 是 Workspace Root 共享 cache；Project 只在既有 `.nbook/config.json` 选择 content scope 与 unknownTagPolicy。官方 facts、NeuroBook policy、run resolution、Project/Pattern approval 各有独立真相源。
- 详细实施见 `docs/superpowers/plans/2026-07-20-route-b-p2-tag-index-resolver.md`。本阶段按 TDD 先落严格合同、SourceClient、可恢复同步与 builder，再接 reader/policy/resolver/import/UI；不会先开放批准。

### 实际结果：官方索引与导入解算纵切

- 建立 Workspace Root 唯一 Tag index 真相源：固定 Danbooru 官方 JSON API、固定 `post_count >= 3000`、本地 upper watermark、source/reconciliation 双轮分页、create-only page cache、四级 Tag 工件、关系闭包、SQLite FTS、manifest 校验与 `current.json` expected-hash CAS 激活。同步失败、取消或重建期间，旧 active index 继续提供查询与 Resolver 服务。
- 同步运行时使用持久 operation、短文件锁与 owner/lease/fence；设置页打开和状态轮询只读本地文件，只有用户显式确认当前 terms content hash 后才联网。429/5xx 退避、cursor、页数、记录数、错误与取消状态均可观察；客户端不能提交 source URL、阈值或第三方数据。
- Project Config 新增唯一 `illustration.tagPolicy` 真相源，Global Config 明确拒绝第二份 policy。Resolver 只消费 active index、内置 policy registry 与一次 run context，输出 canonical、replacement 或受控 passthrough 终态；block/deprecated 不可审批绕过，review approval 绑定 request hash、actor、reason 与 policy evidence。
- Storyboard import 已从 `pending_unresolved` 接到显式 Tag resolution：服务端读取当前 Project policy、由已登录用户派生 actor/approval identity，并生成 review/block gate 或正式 resolved candidate diff。resolved candidate 仍是待发布 companion，不会直接改写全局 selector。
- 文生图设置页新增 active index 摘要、同步/重建/取消、实时进度、旧 active 继续服务提示、SQLite 搜索与插入；Storyboard import 面板新增索引状态刷新、解析、逐项批准及终态 diff。浏览器不保存索引、source page 或 resolution。
- 旧 `TextToImageTagVocabularyPanel`、Tag Vocabulary utility 与 Pinia/localStorage source 状态已硬删除；运行时代码没有 `tagData`、可配置 source URL、IndexedDB 或旧 Tag Vocabulary 消费者。Director Profile/Skill 仍只有 inspect/submit 两个窄工具，没有索引、Project policy、Provider、Recipe 或 NovelAI 生成参数写权限。

### 审查修正与计划偏差

- Windows 并发组合测试暴露短锁文件在删除/读取窗口可能返回 `EPERM/EACCES/EBUSY`；按同一短锁争用语义做有界重试，没有把错误吞掉或引入平台分支真相源。
- 只读审查发现 `source_verified` 恰好位于 source worker 释放 lease 与 builder 领取 lease 之间时，取消请求会被忽略；新增稳定 RED 后允许该无 lease 阶段直接转成 `canceled`。
- 只读审查同时发现 Vue 可选链的 `undefined !== null` 会在状态未加载时误开放搜索/解析；已改为显式 `Boolean(active)`。当前协作约束不允许主动启用独立审查代理，因此本轮完成的是按 `requesting-code-review` 清单的本地主动审查，不伪称独立终审。
- 原计划没有预期 import resolution approval 证据需要与正式 Pattern 一同进入发布编译复验；为保持批准可审计且不落浏览器，已系统性扩展 strict shared contract、prepared journal 与 resolved diff。global pair publish/selector 仍未在本纵切冒充完成。

### 验证与剩余边界

- 聚焦组合回归当前为 `8 files / 40 tests passed`；随后取消边界新增测试单文件 `5 tests passed`。完整 `bun run typecheck` 在索引/API/UI 初次收口后 exit code 0；最终文档与审查修正完成后还会再跑组合回归和 typecheck。
- 静态审计中 `tagData` 只命中拒绝测试和“禁止接收”条款，`sourceUrl` 只命中 strict rejection 测试；旧 Tag Vocabulary/IndexedDB 运行时零命中。无 Prisma schema 变化，因此不运行无意义的 Prisma generate。
- 按约束未自动运行浏览器验证，也未提交、推送或发布。
- P2 仍需 global companion pair publish/selector journal、Project overlay editor 与角色/服装 V2 migration；P3 的 Agent 检索与组合 Pattern 检索也未开放。当前纵切完成不代表 P2 或 Route B 完成。

## 2026-07-20 Route B P2 Global companion publish / selector

### 真相源与发布边界

- Global Config `agent.profiles["illustration.director"].settings.storyboardPresetKey` 是唯一 selector；Profile Home 不新增 selector 文件，浏览器/localStorage 不保存第二份配置。
- 发布 API 只接受 resolved preview token、candidate/diagnostic hash、active pair file hashes、完整 Global Config hash、目标选择与 `targetScope: global + confirmGlobal: true`。actor 由当前用户生成；三条入口同时要求 Project-open、登录与管理员权限。
- approved Storyboard 与 Tag Pattern 使用同一逻辑 identity/package/resourceKey 成对 create-only 发布；selector 只在两份文件均严格复验后最后更新。Agent Profile、Skill 与 convert 工具没有 publish、Config、Provider、Recipe 或 NovelAI 参数写权限。

### 实际结果

- 新增 strict global publish preview/request/receipt/retry 合同。客户端不能提交目标路径、approved Markdown、Prompt、Provider、Recipe 或生成参数。
- 新增确定性 save-as rebase：同步重绑定 presetId/patternSetId/packageId/resourceKey、Pattern resolution keys、group refs、policy approval owner/diff，并重新计算 Storyboard semantic、Pattern planning/render、package hash 与 preview token；terminal resolution 证据不漂移。
- ConfigService 新增只暴露 `storyboardPresetKey + configHash` 的 Director selector snapshot 与 expected-hash CAS。所有 Global Config 写入口共用同一进程临界区，更新 selector 时保留 model/runtime/其他 settings。
- 新增独立 global publish journal：`prepared -> preset_published -> patterns_published -> selector_updated -> completed`，另有 `published_not_selected`。prepare 会重新复验 Project ownership、resolved candidate、原 upload raw hash、sanitized archive 与全部冻结 token/hash；prepared 后恢复不再依赖 upload。
- 发布服务先冻结 approved archive，再写 immutable pair，最后切 selector。preset、Pattern、selector、completed 任一阶段中断均可重放；相同路径不同 bytes fail-closed。Config CAS 冲突时旧 selector 保持不变，用户可用服务端回传的新 config hash 只重试 selector。
- 同一 publishId 的并发 RED 实际复现 journal JSON 被并发截断；现由 normalized global root + importId + publishId 共享锁串行推进 publish/retry，避免 journal 倒退或重复 selector update。
- 文生图导入面板新增 candidate/另存为目标、同 ID 显式替换、active/target pair、三项 expected hash、全局影响确认、发布 receipt 与 selector-only 重试。组件只持有短生命周期 UI 状态，不产生 selector、Provider 或 Recipe 浏览器真相源。

### 错误、验证与计划偏差

- 发布领域错误稳定映射：`STORYBOARD_IMPORT_APPROVAL_INVALID` -> 400；`STORYBOARD_PRESET_STALE`、`STORYBOARD_PRESET_ID_CONFLICT`、`TAG_PATTERN_SET_STALE` -> 409。
- 组合回归先得到 `75 passed / 1 failed`；唯一失败是旧 UI 合同仍要求 early `preview.approval.code` 与永久禁用 Tag resolve。该断言在 active Tag index 已落地后过期，现改为约束 pending approval、resolve、三条 publish API、全局确认与无 localStorage/tagData/Provider/Recipe 写入口；最终 `8 files / 76 tests passed`。
- 完整 `bun run typecheck` exit 0。静态审计确认固定 Skill 明示不实现 publish/selector，Director Profile 明示不读写 Provider/Recipe/NovelAI 参数；UI 无 localStorage、`tagData` 和 Provider/Recipe API。
- 原计划没有覆盖同 publishId 的两个 HTTP 请求同时推进 journal；实际 RED 证明会产生截断 JSON，因此增加共享进程锁。这是状态机正确性修复，不是重试兼容 hack。
- 无 Prisma schema 变化，因此未运行无意义的 Prisma generate。按约束未做浏览器验证，也未提交、推送、发布或操作既有暂存设计文档。

### 后续边界

- P2 下一纵切是 Project Storyboard/Pattern overlay editor 与角色/服装 V2 migration；P3 planning/retrieval、V2 placeholder/Manifest、持久 Provider lane 与 P5/P6 仍未完成，不能宣称 Route B 全量完成。

## 2026-07-20 Route B P2 Project Overlay / Character V2

### 实际结果

- Project Storyboard / Tag Pattern overlay 已形成独立 Project 真相源：只写 `agents/illustration.director/storyboard-overrides/<presetId>.md` 与 `tag-pattern-overrides/<presetId>.md`，Global companion 与 selector 只读。编辑器通过 expected file hash 做 CAS；应用时还绑定当前 base 的 semantic/planning/render hash，并由既有 P0 resolver 对整次 operation fail-closed 复验。
- 文生图分页新增 overlay 面板，分别展示 active base、effective hash、review/effective state、provenance 与 diagnostics。保存草稿固定为 pending；保存并应用由服务端重建 approved review hash。浏览器不持久化第二份配置，Project/Profile/Skill 也没有 Provider、Recipe 或 NovelAI 参数写面。
- Character / Outfit V2 冻结为严格 Markdown 合同：Character 12 个固定字段、Outfit 4 个固定字段、generic NovelAI resolution scope、同文件 resolution/syntax 所有权与完整引用。`visualPlanningFactsHash` 与 `renderTagFactsHash` 分域；正文和显示名不会制造执行事实漂移，resolution evidence、字段 refs 或 typed provider node 变化会使执行事实失效。
- 现有自由字符串 `image-tags.md` / `outfits/*.md` 只由迁移 source reader 读取。迁移按 `scan -> prepare -> resolve/review/block -> ready -> apply/resume` 推进；candidate、report、resolution、apply journal 均位于 Project `.nbook/text-to-image/character-visual-migrations/**`，使用 Project-open guard、当前用户与 tracked write。
- 无 active Tag index 时只生成 `pending_unresolved`，不会改写源文件；用户逐项确认全部 terminal diff 后才可 apply。apply 先全量 render/parse，再以 source/target 精确 hash journaled write；中断可幂等恢复，用户后续修改会以 `SOURCE_FILE_STALE` 拒绝覆盖。
- 新增 V2-only Route B registry：legacy、缺失或无效 V2，缺失 outfit，以及 character/outfit ID、owner、目录身份不一致均 fail-closed。新 Director/Compiler 不会回退旧 parser。

### 错误出口、验证与计划偏差

- 迁移入口稳定区分 `MIGRATION_NOT_FOUND`、`MIGRATION_INVALID`、`MIGRATION_STALE`、`MIGRATION_BLOCKED`、`MIGRATION_NOT_READY` 与 `SOURCE_FILE_STALE`；客户端不能提交 actor/approval identity、目标 Markdown、Provider、Recipe 或生成参数。
- Project overlay + Character/Outfit V2 最终聚焦组合为 `12 files / 40 tests passed`；完整 `bun run typecheck` exit code 0。中间 typecheck 捕获并修正 strict hash 的 `undefined` 投影、并发锁 tail 释放以及固定字段构造类型问题。
- 本纵切没有 Prisma schema 变化，因此未运行 generate。按约束未自动运行浏览器验证，也未提交、推送、发布或操作前序暂存设计文档。
- 原实施计划把旧 detector/completion/placer 的物理删除列在本纵切；冻结总规格要求 P4 替代 workflow 就绪后再硬切，因此当前只建立 V2-only 新读侧，物理删除留到 P4，不建立 adapter。
- 现有 Project 文件迁移已完成，但 TTP Context 中可确定识别的结构化角色/服装字段仍只进入 Storyboard report-only 统计；角色详情 LLM tag generation 也仍会生成旧 source Markdown。两者必须改成统一 proposal-only 入口后，P2 才能整体完成。

## 2026-07-20 Route B P2 Character Visual Sources / Director Proposal-only

### 用户目标与实现边界

- 把公开明文角色/服装 export 与角色详情生成结果汇入同一种 Project Character/Outfit V2 migration；任何 source 都不能直接写 V2 或绕过 active Tag Resolver。
- 标准 SillyTavern card/PNG 保持既有 `novel-import-silly-tavern-card` 唯一解析入口。本模块不解析 PNG chunk、card spec、worldbook、脚本或动态变量，只读取 importer 已落盘的 `lorebook/character/<id>/index.md`。
- 加密/私有/未知角色格式、Storyboard Context 中没有确定结构的角色 prose 继续 report-only；不猜 schema，不建立兼容 adapter。

### 实际结果

- 公开明文 export 新增 strict source package 和安全 parser。源文件按真实 upload 顶层路径读取原始 bytes，复用 duplicate/prototype/depth/size/UTF-8/secret redaction 边界；visual hash 排除 images 与已知非视觉 generation/photo 字段。
- 文生图迁移面板新增 source inspect/preview/prepare：只列真实 Project 角色目录，V2/invalid V2 不可作为迁移覆盖目标；missing/legacy 字段按 exact 三态分类，冲突必须逐项选择。preview 同时绑定 source 三组 hash、整个 target base file set 与 create-only outfit 路径。
- external source 与本地 legacy 最终都写同一 `nbook.character-visual-migration/v2` candidate，进入同一 Resolver、review/block、逐项 accept 和 `nbook.character-visual-migration-apply/v2` journal。apply 前会重读外部 source；源 bytes 或目标文件漂移时零覆盖。
- 角色详情旧链已硬切：删除独立 Provider 选择、`characterDesign` completion、`character-image-tag.extractor` Profile 与直接 `writeWorkspaceTextFile` 视觉写入。按钮只提交 `{projectPath, characterPath}`，模型由全局 `illustration.director` Agent Runtime binding 决定。
- `illustration.director` 增加 `propose-character-visual` strict output。Director report_result 不可执行，先持久为绑定 source file hash、proposal hash、session/invocation 的 Project proposal record；用户逐字段确认后才生成 migration candidate。
- 同一 Profile 的工具权限按 initial operation 在 runtime 注入层收窄：`convert-preset` 只获得两项 import tool + report，角色 proposal 只获得 `report_result`。Profile、角色详情按钮和新 API 不接收 Provider、Recipe、图片模型、采样、尺寸或 seed。
- migration scan 新增未完成 candidate 列表；从角色详情创建 proposal 后，用户可在文生图分页继续 Resolver/accept/apply，不依赖浏览器内存或 localStorage。

### 错误出口、测试与计划差异

- Director binding 缺失使用 `ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED`；Agent 失败/输出非法分别使用稳定 proposal 错误。migration 继续使用既有 `MIGRATION_*` 与 `SOURCE_FILE_STALE`。
- 聚焦组合最终为 `8 files / 37 tests passed`，覆盖 binding 缺失、blocked/非法 hash、operation 工具收窄、公开 source report-only、字段/target 漂移、create-only apply、Director proposal provenance、pending migration 恢复入口及 API/UI 禁止写面。完整 typecheck exit code 0。
- 原计划曾用“Context 结构化角色字段”概括来源；公开源码核对后实际可证明的角色 export 根是 `{characters,outfits}`，并非 Storyboard `entries`。因此实现独立 strict shape；自然语言 Context 不被提升为结构化 Tag source。
- 原计划假设角色详情可能复用旧 extractor 再由 Director收口；实际为避免两个逻辑 Agent 和第二模型配置，旧 extractor 被完全删除，Director 单次 strict proposal 直接取代。
- 本阶段无 Prisma schema 变化，未运行 generate；按约束未自动做浏览器验证，也未提交、推送、发布或触碰前序暂存设计稿。

### 后续

- P2 按冻结边界完成。下一阶段是 P3：确定性检索工具、Pattern retrieval、Chapter/Selection Storyboard planning DTO/workflow 与发布事务。
- 旧正文 detector/completion/placer 的物理删除仍按规格留在 P4，与 V2 placeholder/Manifest/Compiler 替代链同步硬切，不建立中间 adapter。

## 2026-07-20 P3 plan-only 第一纵切

### 实际结果

- 建立 strict Chapter/Selection planning 合同、deterministic Pattern retrieval 与 run-scoped Tag/Pattern 窄工具。每次运行冻结 Project Tag Policy、active Tag index identity、Resolver/capability version 和 Pattern CandidateSet；工具重读时发现 active identity 漂移会失败关闭。
- `IllustrationPlanningInputBuilder` 只从服务端真相源组装 immutable bundle：portable Project ID、已保存章节、effective Project overlay、Character/Outfit V2、Recipe planning constraints、全局 `illustration.director` binding、continuity baseline 与 active Tag index。API key、正负画风串和 NovelAI sampler/scheduler/steps/guidance/尺寸/seed/SMEA 不进入 Agent 输入。
- Project SQLite 新增 stable `ProjectMetadata.projectId`、`IllustrationPlanningWorkflow`、`IllustrationPlanningAttempt`；repository 负责同 request hash 原子复用与状态 CAS，scheduler 按 Director 设置的 1–4 并发创建独立 Agent session/attempt，并把 Agent 成功后的 validation failure 与 invocation failure 分开持久化。
- 新增严格 start/list/get API 和公开只读 DTO。浏览器不能提交 provider/model/recipeSource/modelKey、policy、candidate、hash、session 或 actor；完整 frozen input、工具 evidence 与运行配置不会从 DTO 返回。
- 文生图分页新增 `TextToImageIllustrationWorkflowPanel.vue`，只读显示 queue/status/hash/validated Shot Intent 并仅轮询 active Workflow；没有 Director LLM、NovelAI 或 Recipe 保存入口。
- 正文工具栏“正文生图”启动 `plan-chapter`；TipTap 选区菜单新增“规划选区插图”入口。选区链先保存正文，复用 TipTap 可信行范围，再对已保存 Markdown 做精确唯一匹配并计算 SHA-256；保存冲突、章节切换、找不到或仍歧义均阻断。
- P4 执行边界未越过：本轮不写 `illustrations.md`，不发布 Placeholder，不建图片 Job，不调用 NovelAI；现有 placeholder 执行入口明确提示后续纵切。

### 主要文件

- `shared/text-to-image-illustration-planning.ts`
- `shared/text-to-image-illustration-workflow.ts`
- `server/text-to-image/illustration-chapter-parser.ts`
- `server/text-to-image/illustration-plan-validator.ts`
- `server/text-to-image/illustration-planning-input.builder.ts`
- `server/text-to-image/illustration-workflow.repository.ts`
- `server/text-to-image/illustration-workflow.scheduler.ts`
- `server/text-to-image/illustration-workflow.service.ts`
- `server/api/text-to-image/illustration-workflows/**`
- `app/components/novel-ide/text-to-image/TextToImageIllustrationWorkflowPanel.vue`
- `app/utils/illustration-planning-selection.ts`
- `app/components/markdown-studio/MarkdownSelectionMenu.vue`
- `app/components/markdown-studio/TipTapMarkdownEditor.vue`
- `app/pages/index.vue`
- `prisma/project.schema.prisma`

### 验证

- `bunx prisma generate --schema prisma/project.schema.prisma` 成功，Prisma Client 7.3.0 生成到 `server/generated/project-prisma`。
- 选区捕获 RED/GREEN 后 `1 file / 2 tests passed`；类型根因修正覆盖的 parser/validator/repository/selection 组合为 `4 files / 15 tests passed`。
- 最终 P3 组合回归：`15 files / 56 tests passed`，覆盖 strict contracts、parser/selection、Tag index frozen read、Pattern retrieval、Agent tools/Profile、Input Builder、repository/scheduler/service/API 与前端选区纯逻辑。
- Prisma generate 后 Project migration/repository 复验 `2 files / 7 tests passed`；最终完整 `bun run typecheck` exit 0（129.4 秒）。未自动做浏览器验证。

### 与计划的差异 / 后续

- 详细计划中的显式 cancel/retry、进程重启 recovery 扫描与 replan 操作 UI 尚未进入本次第一纵切；这些缺口已在下述 2026-07-21 hardening 闭合。
- 计划早期曾把 Storyboard 发布事务写在 P3 总阶段；按冻结规格纠正到 P4，避免 scheduler 夹带 Project 文件写入。
- 未提交、推送或发布，也未改动前序暂存设计文档。

## 2026-07-21 P3 cancel / retry / restart recovery hardening

### 实际结果

- Planning Input 增加服务端 `rebuild`：旧 bundle 只提供冻结请求语义，所有 Director binding、active Tag index/policy、effective overlay、Character/Outfit V2、Recipe planning constraints 与 continuity 都重新读取。整章正文或任一依赖漂移会产生新 hash；选区所属章节只要原始 bytes 变化就 fail-closed，不尝试用浏览器坐标重建。
- Project repository 增加单 Workflow cancel、recoverable scan、restart recover 与 mark-stale CAS。取消只关闭目标 Attempt；重启旧 Attempt 一律 `interrupted`，不续跑 partial output。只有当前重建的 request/input hash 同时精确一致才重新 queued，否则稳定进入 stale。
- scheduler 为每条 active run 保存独立取消信号/session，并调用 Agent Harness abort。repository 的 canceled 是最终真相；迟到 invocation 结果只释放 evidence，不再写 failed/ready。service 复用每 Project scheduler，让 cancel 能命中当前进程 run；首次访问已打开 Project 时执行一次懒恢复，不扫描未打开 Project。
- 新增 cancel/retry/replan API 与面板操作。retry 复用原 request 且必须 exact hash；replan 由服务端生成 nonce 并记录用户 reason，产生新 Workflow。请求 DTO 和 UI 都没有 provider/model/Recipe/hash/session/actor 或 localStorage 写面。
- `ILLUSTRATION_WORKFLOW_INPUT_STALE` 已硬切为冻结合同 `ILLUSTRATION_WORKFLOW_STALE`，没有 legacy alias。数据库已有完整状态字段，本批没有 Prisma schema 变化。

### 验证与计划差异

- 10 项新增合同先实际 RED；最终 P3 hardening 为 `6 files / 21 tests passed`，覆盖 immutable rebuild、selection chapter drift、跨章节取消隔离、迟到结果 fencing、restart queued/stale、显式 retry/replan、严格 action API 与 UI 无第二真相源。
- 首轮 typecheck 发现持久 selection context 被误标为 parser 内部含行号类型。根因是持久合同刻意不保存客户端/行坐标；修正为内部消费持久 snapshot 类型，没有向 bundle 添加第二定位真相。最小 builder `1 file / 4 tests passed`，完整 typecheck exit 0（141.6 秒）。
- 原计划可理解为应用启动时全盘扫描 recovery；实际采用“已打开 Project 首次访问时恢复”，因为仓库没有也不应新增 App 级 Project 索引，且所有入口都必须受 Project-open guard 约束。这是恢复触发时机差异，不改变 interrupted → queued/stale 语义。
- P3 至此完成；下一阶段进入 P4 的 Storyboard plan publish、V2 placeholder、Apply Journal、Compiler/Manifest/Job 与旧正文链硬切。未自动做浏览器验证，未提交、推送、发布或触碰前序暂存设计文档。

## 2026-07-21 P4 Storyboard / Placeholder / Planning Apply

### 实际结果

- 新增 strict `nbook.chapter-illustrations/v2` Storyboard 与 Markdown codec。每条 planning source 保存冻结输入哈希与精确来源，每条 shot 保存 Shot Intent、终态 Tag resolution、publication journal 和 reference-only 执行身份；plan hash 不被审计时间或整文件 revision 污染。
- 正文按钮硬切为 V2 placeholder，只保存 `shotId/shotIntentHash/sourceChapterHash/anchorId/origin`。旧自由 prompt、negative prompt、角色 ID payload 与 paragraph-offset 插入合同被移除；NodeView 只发出 placeholderId，不维护浏览器内运行真相。
- 新增 Project `IllustrationPlanningApplyJournal` 与真实 SQLite repository。journal payload 固化 Storyboard before/staged/applied 和 chapter before/after 的完整 bytes/hash、placeholder 集合及 workflow 来源哈希；同 workflow 只允许一份完全相同的 create-only payload。
- `PlanningApplyService` 用短章节文件锁执行 exact-hash 阶段事务。每个 durable stage 都可恢复；正文写前漂移仅在 staged bytes 仍精确匹配时回滚，正文写后任何无法安全补偿的漂移都进入 `apply_conflict/stale`，不模糊重定位或追加到章末。
- chapter replan 在章节写成功后才 supersede 旧 chapter-plan shot/placeholder；selection 和已生成图片保留。整个发布阶段零图片 Job、零 Provider 调用。
- workflow scheduler 在 Agent evidence/validated plan 封存后调用发布器；journal completed 才 `ready`。发布基础设施中断保留 `applying` 供恢复。服务首次访问 Project 时先恢复 apply journal，再处理 running/validating Attempt。

### 验证与计划差异

- Task 1/2 strict contract + codec/UI 静态测试、Task 3 journal/schema 真实 SQLite 测试以及 Task 4 crash matrix 均先 RED 后 GREEN。
- Task 4 最终组合回归为 `5 files / 22 tests passed`；完整 typecheck exit code 0（109.4 秒）。Prisma Client 7.3.0 已按新 schema 生成。
- 原计划把通用 tracked delete helper 直接用于 isolated Project root；实现核对发现该 helper 依赖活跃 Project 解析。新增 resolved-root tracked deletion 入口后，测试与生产共享相同 history/actor 边界，没有用测试专用路径 hack。
- 未自动运行浏览器验证，未提交、推送、发布，也未操作已有暂存设计文档。下一步进入严格 Compiler 与 execution hash。

## 2026-07-21 Route B P4 Typed Compiler / Execution Hash

### 实际结果

- 新增 strict execution contracts：CompiledRequest 保存精确 NovelAI wire prompt、角色 prompt/UC、参数、RecipeSnapshot、Provider/credential revision、capability snapshot 与引用展开证据，并通过自 hash 拒绝任意字段漂移；execution input 与 manifest 使用独立 domain hash。
- 新 Compiler 每次从服务端 owner 事实重建请求。只有 Shot 实际引用的 Pattern render hash 进入 execution identity；未引用 Pattern 改动不会污染本次 hash，已引用 Pattern、角色/服装 render facts、Recipe planning constraints 或 publication identity 漂移都会阻断。
- generic NovelAI resolution 不会直接进 adapter：Compiler 要求当前 Recipe model 的终态复验结果与输入逐项同源、等长且 exact model-scoped。provider passthrough 保留审核后的 wire text；空项、未知模型、capability 不一致、缺失 owner/evidence 均 fail-closed。
- Prompt 合并固化稳定顺序、语义去重、最大权重、结构化 NovelAI weight、shot-size visibility 与角色锁定冲突。Shot avoid 只可移除非 mandatory 的 Pattern 建议，不能覆盖 Recipe 或 Character/Outfit V2 事实。
- NovelAI quality tags 与 UC preset 已上移为共享 Provider grammar 单一真相源；旧生成适配器和新 Compiler 共同消费，不再维护两份表。
- 为闭合执行证据，Pattern 现在同文件持久化 typed provider syntax nodes；Character/Outfit V2 同文件持久化 migration review approval。Agent/Profile/Storyboard/正文按钮仍没有 NovelAI 参数或 Recipe 写权限。

### 验证与计划差异

- Task 5 canonical RED 先以缺失 execution/compiler 模块稳定失败；最终权威聚焦为 `2 files / 7 tests passed`，覆盖 canonical expansion、replacement/passthrough、去重、冲突、景别、稳定顺序/权重、模型复验、引用 hash 与 quality/UC grammar。
- owner/migration/旧 NovelAI 请求相关组合共 7 文件 42 项；首次仅暴露 Recipe planning hash 使用裸 64 hex 而非 `sha256:` contract hash，按各自真实 hash 域修正。完整 `bun run typecheck` exit 0（99.9 秒）。
- 计划把 `PROVIDER_GRAMMAR_REGISTRY` 作为 Compiler 消费项；实际 quality/UC 表此前私有于旧 adapter，因此系统性抽成 shared module 并由两条链共同消费，避免复制常量。
- 未自动做浏览器验证，未提交、推送、发布或触碰前序暂存设计稿。下一步实现签名 execution preview、确定性随机 seed 与严格零写入边界。

## 2026-07-21 Route B P4 Signed Execution Preview

### 实际结果

- 建立短期 HMAC Execution Preview token，claims 只含 execution nonce、target hash、候选 manifest hash与 expiresAt；完整 Prompt、CompiledRequest、secret 不进 token。篡改和严格 TTL 均 fail-closed。
- 单按钮随机 seed 按冻结公式确定性派生；批量共享 nonce，但按 source/output index 分离。fixed seed 只由已保存 Recipe 读取，浏览器不能提交 seed。
- 新增真实服务端编译端口，唯一定位正文 V2 placeholder 与同章 `illustrations.md`，复验正文语义、可信锚点、Shot/Planning Source/publication 闭包，再读取当前 Effective Preset/Pattern、Character/Outfit V2、Recipe、owner 唯一 Provider 与 active Tag index/policy。
- Recipe 画风串与 Pattern/角色 resolution 最终都按当前实际 NovelAI model 复验。所有派生只存在于 Preview/CompiledRequest，不写回 Storyboard、Pattern、角色、Recipe 或 Provider。
- GET Preview 与 batch Preview API 只接收 Project/placeholder 引用，绑定当前用户和 Project-open guard。服务没有 repository、queue 或文件 writer；批量任一 blocking error 时不返回可用 token。
- Preview HMAC 复用 Product Root 已持久化的 `NUXT_SESSION_PASSWORD`；缺失或不足 32 bytes 返回稳定服务配置错误，GET 不创建新 secret。Provider Preview snapshot 走纯读取接口，不触发 partial-unique finalizer。
- Provider schema 增加 `credentialRevision`：首次为 1，仅真实替换 token 时递增；名称、请求间隔与无 credential 保存保持 revision。旧 revision 将在后续 Job/lane 中作为 configuration-stale fence。

### 验证、错误出口与计划差异

- Preview/Compiler/Token/API/Provider 聚焦为 `6 files / 32 tests passed`；credentialRevision migration 解析与真实内存 SQLite 执行为 `1 file / 3 tests passed`；完整 `bun run typecheck` exit 0（79.1 秒）。App Prisma generate 已成功。
- typecheck 首次发现共享 Recipe 规划 helper 的单元素数组读取可能产生 `undefined`；修正为显式 `null` 收窄。Compiler 同时把 Recipe constraints hash 硬切为标准 `sha256:` 合同，不接受旧裸 hash。
- 原 P4 计划使用 `/illustration-executions/*` 临时路径；冻结设计已明确最终 endpoint 为 `/prompt-placeholders/*`，实际按设计终态实现，未建立兼容路由。
- 为满足“正文生成图片不污染 sourceChapterHash”，实现额外读取 Project DB owner assets 并仅移除 canonical renderer 的精确 Markdown；不会扫描 alt text、路径前缀或用户图片。
- 未运行浏览器验证；未提交、推送、发布，也未改动前序暂存设计文档。下一步是原子 Manifest/Approval/Job/outbox 注册。

## 2026-07-21 Route B P4 Atomic Manifest / Approval / Job Registration

### 实际结果

- Project DB 新增不可变 `IllustrationExecutionManifest`、`IllustrationExecutionApproval` 和 `TextToImageDispatchOutbox`；`TextToImageJob` 增加严格 origin、source identity、provider owner/credential revision、manifest/approval/compiled request 与 idempotency identity。新 Route B repository 只接受完整 typed CompiledRequests，不接收浏览器拼装请求。
- 注册入口在一个真实 SQLite Prisma transaction 内创建 Manifest、Approval、全部 Jobs 与全部 outbox；任何阶段异常全量回滚。相同 manifest 或相同完整 dispatch identity 闭集返回原 receipt；部分命中、跨 Manifest 或不完整闭包均 fail-closed。
- button source identity 固定为章节路径、placeholderId、shotId 与 `chapter-plan|selection` origin；`shotIntentHash/sourceChapterHash` 留在 CompiledRequest 的可变执行事实中，不污染用户点击来源的稳定身份。manual/character/retry/reroll 则使用独立判别合同，后续入口不能复用 button 字段蒙混。
- 单按钮和批量授权使用 `/api/text-to-image/prompt-placeholders/:placeholderId/generate` 与 `generate-batch`。请求体严格限制为 Project、preview token、manifest hash 与 output/cost/token 授权上限；服务端验证签名、浏览器所见 manifest 后，从当前服务端真相源再次编译。nonce 相同但 manifest 漂移时不静默执行，必须重新 preview/确认。
- `illustration` Job 只注册为 Project outbox pending。旧进程内 `TextToImageQueueService` 在 enqueue、retry、recover、run 四层排除新 kind，保证后续持久 App lane 是唯一执行者；没有把新链兼容回旧 Queue。
- 旧 Project DB 通过幂等 schema upgrader 先补 Job 新列，再创建 execution 表与索引；Project schema 中过渡期 optional 字段仅服务于尚未在 Task 10 删除的旧 Job 种类，Route B 注册入口始终写满闭包。

### 验证、错误出口与计划差异

- Project Prisma Client 7.3.0 generate 成功。最终聚焦组合 `5 files / 33 tests passed`，覆盖原子写入、approval 后注入失败全回滚、相同 manifest 幂等、不同 manifest/相同 dispatch identity 幂等、授权时服务端重编译、严格 API、旧库 migration 与旧 Queue 隔离。
- 首轮完整 typecheck 只发现新增 `illustration` kind 后 UI 标签映射未穷尽，以及测试 fixture 的 `shotOrigin` 被扩宽为 string；保留 `Record<JobKind, string>` 穷尽约束并收窄 fixture 后，完整 typecheck exit 0（93.4 秒）。
- 原计划的 `/illustration-executions/authorize` 临时路径未实现；实际按冻结终态接口落在 placeholder 资源下，没有 redirect 或兼容路由。错误统一经 execution HTTP mapper 输出稳定 token/service/registration code，前端无需解析数据库异常。
- 未运行浏览器验证；未提交、推送、发布或触碰前序暂存设计文档。下一步实现 server-owned placeholder state、lazy preview 与批量单次确认。

## 2026-07-21 Route B P4 Server-owned Placeholder State / Confirmation UI

### 实际结果

- 新增严格 shared UI contracts：Execution Preview 只公开 Recipe 名、provider identity revision、model/尺寸/seed/hash/预算摘要，不公开完整 Prompt 或 secret；placeholder 状态固定为 `ready|stale|compiling|queued|running|failed|outcome_unknown`。
- `/api/text-to-image/prompt-placeholders/:placeholderId/status` 绑定 current user 与 Project-open guard。它先读取 Project SQLite 最新 illustration Job；无 Job 才调用只读 target/Recipe 校验。结构漂移投影为稳定 `ILLUSTRATION_PLACEHOLDER_STALE`，意外文件/数据库错误继续抛出，不被伪装为 stale。
- TextToImagePrompt NodeView 改为 typed controller：进入可视区才加载 status + Preview，queued/running 从服务端短轮询；更新/销毁后迟到响应通过 request version fence 丢弃。节点没有本地 Job/Manifest Map，仅呈现宿主返回的有限状态和安全摘要。
- 页面宿主 cache 只保存短期 Preview DTO，以 Project + placeholder 为键，并由 statusHash、sourceIdentityHash、TTL 共同失效。按钮点击前重读 status；已展示 Preview 未漂移时一次点击入队，漂移/过期时展示新摘要并重新确认。请求 builder 无 prompt/style/model/Provider/Recipe/seed override 字段。
- ready Workflow DTO 从 completed Planning Apply Journal 读取发布 placeholder IDs。文生图面板“生成全部”先逐项查询 server-owned status，只把 ready IDs 组成一次 batch Preview，展示单一 Manifest/预算并一次确认、一次原子 POST；任一授权时漂移会刷新整批，不产生半批注册。

### 验证与计划差异

- Task 8 RED 以缺失 shared UI contract 稳定失败；核心状态/请求/UI测试 `2 files / 15 tests passed`，补强后 UI/HTTP `2 files / 17 tests passed`。Task 6–8 组合 `6 files / 30 tests passed`，Markdown extension 与 V2 codec `2 files / 20 tests passed`；完整 typecheck exit 0（100.2 秒）。
- 原计划仍写临时 `illustration-placeholders` 状态路径，实际按冻结规格使用 `/prompt-placeholders/:id/status`，没有兼容路由。Vue emit 不能返回异步状态，因此事件链硬切为 controller prop，而不是新增浏览器全局 Map。
- 未自动运行浏览器验证；未提交、推送、发布或改动前序暂存设计文档。下一步实现精确 Asset result insertion 与 attempt lineage fence。

## 2026-07-21 Route B P4 Exact Asset Result / Attempt Lineage Fence

### 实际结果

- 新增 `IllustrationResultService.applyAssetResult` 作为 Route B 图片完成的唯一正文回写入口。输入只允许 Project、Job、已登记 Asset 与当前 attempt fence；浏览器不能提交 Markdown、图片路径、Prompt、Recipe 或生成参数。
- `IllustrationCompiledRequest.source` 补齐 V2 `anchorId`。结果服务严格复验 Job kind/provider owner/provider ID/credential revision/compiled hash/source identity、button origin、Asset job/source 与 CompiledRequest；任何谱系断裂都从稳定 invalid-result 出口拒绝。
- `TextToImageChapterService.replaceIllustrationPrompt` 在章节锁内先按外层 placeholderId 精确定位，再比较 `shotId/shotIntentHash/sourceChapterHash/anchorId/origin` 全字段。完全匹配才替换成 canonical Asset Markdown；占位符已删除返回 `missing`，同 ID 内容漂移或 shot 被 replan 替换返回 `late`，均不追加到章末、不触碰手工图或外链图。
- Project Job 新增 `activeAttemptId/activeAttemptFence`。结果只在 `completing + exact attempt + compiledRequestHash` 下 CAS 到 succeeded；旧 attempt 返回 `late` 且不修改正文/Job。Asset 历史在 missing/late 时保留；相同 attempt/asset 重复完成以 canonical Markdown 和 terminal receipt 幂等收敛。

### 验证、错误出口与计划差异

- exact-match RED 先因缺失结果服务稳定失败。首轮 GREEN 六项业务路径均执行完成，但 `afterEach` 超时；对照既有 ChapterService 后确认根因是测试 reset 清空资源属主后漏注册 Project Prisma client owner，SQLite handle 未释放。补齐真实生命周期后 `1 file / 6 tests passed`，没有扩大 timeout。
- Prisma Client 7.3.0 已按新增 Job fence 字段生成。Task 9 影响面回归 `7 files / 37 tests passed`，覆盖 shared schema、纯/生产 Compiler、Preview/授权服务、Project migration 与结果回写；完整 `bun run typecheck` exit 0（100 秒）。
- 原计划把 immutable payload identity 视为已有事实；实现核对发现 CompiledRequest source 缺 `anchorId`，无法证明 V2 全字段闭合。本轮直接硬切 shared contract 与所有生产/测试构建器，没有兼容 optional 字段。稳定 button source identity 仍不含 anchor，避免把可变锚点误并入点击幂等域。
- 未自动运行浏览器验证；未提交、推送、发布，也未改动前序暂存设计文档。下一步物理删除旧 detector/completion/placer/V1 正文链。

## 2026-07-21 Route B P4 旧正文链硬切与阶段验收

### 实际结果

- 旧正文专用 LLM workspace、provider/context store、completion/models API、角色检测与 prompt placement API/service、旧 prompt compiler、角色 visual direct-write utility，以及 detector/placer Profile、Skill、测试均已物理删除。generic TextToImage Provider CRUD 同步删除，Provider DTO/schema/service 只允许每用户 NovelAI singleton。
- 文生图分页不再保存第二份 Director LLM 配置；正文入口只启动 `illustration.director` planning。正文 Workbench/Toolbar/page 的 `bodyImage*` props/event 已硬切为 `canPlanIllustrations/illustrationPlanningBusy/plan-illustrations`，接口语义不再暗示按钮可直接提交图片参数。
- 旧进程内 Queue 的 public enqueue 被收窄为 `manual`；旧 body Job 的首图替换分支和 `TextToImageChapterService.replacePrompt` 被删除。新 `illustration` Job 继续只由 P4 immutable registration 写入 Project outbox，等待 App DB 持久 lane 消费。
- 内置 Profile 源码删除后通过正式全量 Profile publish 重建 `.compiled/manifest.json` 并 prune detector/placer 的四个 hash artifact；没有手改 manifest 或保留隐藏 runtime cache。
- 历史 Job/Asset 未迁移改写或自动删除。硬切移除的是旧执行主链，既有图片历史继续可读，符合“旧资产不覆盖、不自动删除”的冻结边界。

### 验证、错误出口与计划差异

- 负向静态测试先稳定 RED 为 17 个旧文件，消费者/服务/资产删除后只剩编译缓存 6 个引用；Profile 全量 publish 后 `route-b-old-chain-removal.test.ts` 转绿，并持续审计旧 key、endpoint、context/store、generic Provider kind、旧按钮与 replacement seam。
- App Prisma 与 Project Prisma Client 7.3.0 均生成成功。P4 Task 1–10 核心 `15 files / 59 tests passed`；P3/Recipe/Provider/Character V2/overlay/Project migration 影响面 `19 files / 86 tests passed`；Director Profile/Skill、workflow、placeholder 与授权 API 所有权门禁 `5 files / 26 tests passed`；完整 typecheck exit 0（97.2 秒）。
- Profile catalog 组合回归首次 93/95，两个真实 TSX 编译测试超过默认 5 秒；隔离单用例仍在 5.03 秒触发阈值，而临时 15 秒命令行阈值下 7.64 秒完成且断言通过。该问题与旧链功能无关，本轮没有修改无关测试 timeout。
- 计划文件原本只列出 detector/placer 源码；实际 Product runtime 还包含编译 manifest/artifact，因此系统性扩展到正式 Profile release/prune。Task 10 与 P4 至此完成；下一阶段是跨 Project 持久 15 秒 NovelAI lane、attempt lease/fence 与 restart recovery。
- 未自动运行浏览器验证，未暂存、提交、推送或发布，也未操作前序设计稿的暂存状态。

## 2026-07-21 Route B Persistent Provider Lane / Credential Revision

### 实际结果与真相源

- P4 Project outbox 已接入 App DB 唯一持久调度投影：`TextToImageDispatchPreparation` 只保存跨库 preparation identity/version/lease，`TextToImageProviderLaneItem` 只保存 dispatch/job/provider/project identity 与 claim/send fence，`TextToImageProviderThrottle` 只保存 `(ownerUserId, providerId)` 的下一次允许时间和 active attempt。App DB 不复制 CompiledRequest、Recipe、Prompt 或 Provider secret；Project DB 继续独占 Manifest/Approval/Job/CompiledRequest/Asset/正文结果。
- 授权改为诚实的三段式 saga：App 原子创建 inert preparation/items → Project 原子注册完整 Manifest/Approval/Job/outbox closure → App 按 exact preparation attempt/version CAS 提升 ready。Project 已提交但 App promotion 失败时返回 `dispatch_pending`，不补偿删除 Project 真相；后台从 App preparation 根恢复。
- Project-independent reconciler 用短连接读取关闭的 Project SQLite，先尝试持久 projectPath，再只按 exact `ProjectMetadata.projectId` 重定位。精确 closure 可提升 ready；确认没有提交才 abandoned；不可达、歧义、损坏或旧版本冲突都隔离，绝不把“暂时读不到”当成可重新付费发送。
- 每用户/Provider lane 在 App transaction 内以 owner lock、CAS、lease 和 fence 串行化。`ready -> leased` 尚未越过付费边界，lease 过期可回 ready；只有 revision 与 throttle 复验通过后才持久 `attempt_started + sendAttemptId + sendFence + nextAllowedAt`。有效间隔固定为 `max(15_000, configuredRequestIntervalMs)`，长请求期间 active attempt 阻止重叠发送，进程重启不会重置时钟。
- NovelAI 执行 adapter 只消费自校验的 `IllustrationCompiledRequest`，逐字段映射 prompt/negative/character prompts/UC/model/sampler/noise/scheduler/steps/guidance/尺寸/seed/SMEA；不重读 Markdown/Pattern，不重组 Prompt，不随机 seed，不做隐藏 retry。生产 worker 在 `attempt_started` 前后都复验 Project immutable closure；只有明确 429/5xx 响应进入持久 `retry_wait -> retry_leased -> attempt_started` 新 attempt，网络/timeout 等不确定窗口仍进入 `outcome_unknown`，永不自动 rearm。
- 结果写回使用 Project 短连接、严格 attempt fence、既有 AssetService 与 `IllustrationResultService`；Project 已形成 matching succeeded/failed 终态而 App 崩溃时，过期 attempt 恢复会镜像该终态，否则只收口为 outcome unknown。

### 凭证替换与跨库恢复

- `saveNovelAi` 只在 App owner transaction 内解密已有 token 做明文比较：名称/间隔更新和同 token 重加密保持 revision；不同 token 恰好递增一次。Provider 保存与 lane start 使用同一个正 owner lock；`startAttempt` 还在该 owner transaction 内解密并返回仅内存 credential，Project dispatch 不再二次读取 Provider。token 随 attempt fence 一起线性化，因此之后的配置替换不会让旧 attempt 静默改用新账户。
- 换 token 的同一 App transaction 会把旧 revision 的 `prepared/project_committed/ready` preparation 与 `prepared/ready/leased/retry_wait/retry_leased` item 标为 `TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE`，清理未发送 claim；`attempt_started`、send fence 与 throttle 保持不变。
- Project DB 不能加入 App transaction，因此实际增加按精确 `projectId + projectPath` 逐目标持久化的 `TextToImageProviderRevisionInvalidation` saga。设置保存后只访问失效 lane 闭包中的目标 Project，并允许仅按 exact `ProjectMetadata.projectId` 重定位；目标暂不可达、歧义或同步失败时该条 saga 保持 pending、记录 attempt/error，绝不因为全局扫描暂时看不到 Project 而提前完成。running/completing 不被终止或重发。

### 生产生命周期、状态与权限边界

- 新 Nitro plugin 启动有界周期 runtime，顺序执行 preparation reconcile、revision saga、过期 lease/attempt 恢复、最多四项 dispatch 与空 throttle 清理；重叠 tick 复用同一批次。close hook 先进入不可逆 stopping 并通过 lifecycle signal 中止在途远端请求，再等待当前批次收口；110 秒硬 timeout 与 lifecycle abort 组合生效。global runtime 按 Nitro app owner 引用计数，热重载不会丢失 close hook。ready/retry 候选在 SQLite 查询层以 `NOT EXISTS` 排除 busy/throttled lane，再按全局创建顺序取有界批次，因此大量受阻 item 不会占用扫描窗口或饿死后续 Provider lane。
- UI 没有新增浏览器/localStorage lane 或 15 秒锁。现有 Project Job DTO、placeholder 与历史面板已经显示 queued/running/configuration stale/outcome unknown，继续只读取服务端投影。
- Director binding 仍只由全局“设置 → 模型配置”编辑，文生图分页只读摘要并跳转；NovelAI Provider/API、Recipe 和全部生成参数仍只由文生图分页管理。Profile、Skill、Storyboard 与正文按钮没有获得 Provider secret、Recipe、Prompt override 或生成参数写 DTO。

### 验证、错误出口与计划差异

- App Prisma Client 7.3.0 已按 SQLite schema 重新生成；App/MySQL 与 SQLite migration 同步包含 preparation、lane item、throttle、逐 Project credential revision invalidation saga，以及 claim/send/error/throttle/saga 的状态组合 CHECK。Project schema/upgrader同步包含 preparation stamp、provider revision 与 attempt fence。
- 独立审查后的修复聚焦回归为 `12 files / 56 tests passed`；最终 lane/P4 受影响回归为 `29 files / 143 tests passed`；completed saga 重开与 canonical saga ID 定向回归为 `4 files / 21 tests passed`；最终 `bun run typecheck` exit 0。覆盖显式 429/5xx 重试、retry 崩溃恢复、凭据/fence 线性化、大量受阻 lane 饥饿、精确 Project saga、暂不可达保留、已完成 saga 后发重开、晚到版本立即重绑、混合版本拒绝、迁移非法组合与 shutdown abort。最终独立复核无 Critical/Important，Ready verdict 为 Yes。
- 原计划只列三类 App lane 表；实际凭证替换若没有持久 Project propagation 决定，会在“App 已提交、Project 暂时不可达”窗口失去恢复根，因此增加逐目标 revision invalidation saga。独立审查还发现原实现把 429/5xx 直接终结、`attempt_started` 后二次读取 credential、close 只等待以及晚到提交只能等后台扫描；实际以新 retry 状态、owner-transaction credential 闭包、lifecycle abort 和 authorize-time atomic rebind 系统性收口，没有使用双写 localStorage、兼容 adapter 或吞掉旧状态。
- 未自动运行浏览器验证；未暂存、提交、推送、发布，也未改变前序设计文档的暂存状态。Route B 的持久 Provider lane 阶段完成；总计划仍有 P5/P6 与最终授权验收，不在本节冒充整份规格最终完成。

## 2026-07-24 多画风串、自动保存与 illustration.director 修复

### 实际结果

- 用户要求精简文生图分页文案（"保存为唯一 NovelAI Provider"等）、Recipe 默认为自动保存、以及修复 `illustration.director` 无法选择模型的问题。
- 方案选择：Recipe 总在最前、单 Recipe 无歧义，始终直接覆盖；不存在旧 Recipe 恢复问题，无需"恢复"按钮或手动"保存"。
- Recipe v3 schema：单 `style` 改为 `styles[]` 数组，新增 `activeStyleId` 字段。v2→v3 迁移在 codec 层完成，单 style 包入数组。
- 多画风串 UI：`NovelTextToImagePanel.vue` 新增选择器和新建/复制/删除三个按钮，通过 `stylePresetOptions` computed 绑定数据，调用 store 的 `addStylePreset`、`duplicateStylePreset`、`activateStylePreset`、`deleteStylePreset`。
- Recipe 自动保存：watch novelAi/stylePresets/activeStyleId/recipeSavedSource 变更时自动 render+write 到 `text-to-image-recipe.md`。
- Recipe 路由修复：`recipe.service.ts` 的 `assertProjectOpen()` 现在接受 `workspace/<slug>` 格式 projectPath。
- 文案精简：Provicder 区"保存为唯一 NovelAI Provider" → "保存"，"重新检测连接" → "检测"，移除多余描述。

### 验证

- 聚焦 5 文件 29 项全部通过：store (5)、codec (5)、service (9)、migration (4)、compiler (6)。
- 编译器测试夹具 v2→v3 升级：`illustration-compiler.test.ts` 的 recipeSnapshot helper 现在使用 `styles[] + activeStyleId`。
- typecheck exit 0。

### 主要变更文件

- `shared/text-to-image-recipe.ts`：schema v3，`styles[]` + `activeStyleId`
- `app/stores/text-to-image.ts`：多画风串 store 操作、自动保存
- `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`：多画风串 UI、文案精简
- `server/text-to-image/recipe.codec.ts`：v2→v3 迁移
- `server/text-to-image/recipe.service.ts`：修复 assertProjectOpen 接受 workspace/ 格式
- `server/text-to-image/illustration-compiler.test.ts`：v2→v3 测试夹具

## 2026-07-26 Illustration Director 三问题修复

### 用户问题与根因

- 正文生图报 `STORYBOARD_PRESET_STALE`：bundled Profile Home 的两个 `default.md` 实际误放了 `ttp-cinematic` pending candidate，且 Storyboard/Pattern `resourceKey` 不一致；初始化器又只检查 preset 文件是否存在，导致坏 pair 永久跳过纠正。
- 角色视觉 proposal 一次缺少八个顶层字段：Director `OutputSchema` 是 TypeBox union，`isEmptyObjectSchema()` 只看顶层 `properties`，把 union 误判为空；模型可见 `report_result` 因此没有 `data`，执行期也允许只有 `result` 的调用终止。
- 设置中无法更换 Director：模型设置组件化后，草稿/Global Config 保存链仍在，但专用模型卡没有迁入新面板；通用 Profile 面板仍按合同禁止编辑 Director，因此没有可用入口。

### 实际修复

- `ensureDefaultStoryboardPreset()` 现在始终读取并用正式 codec/resolver 验证两份默认工件。全新 Workspace Root `.nbook`、系统默认残缺 pair、以及固定身份的误置 TTP candidate 会成对恢复为 approved 默认 companion；无法识别的用户文件保持原样，继续由 strict resolver fail-closed，不做自动批准或通用覆盖。
- bundled `storyboard-presets/default.md` 与 `tag-patterns/default.md` 已改为同 `presetId/packageId/resourceKey` 的 approved 安全默认 pair；独立 `ttp-cinematic.md` candidate 保持 pending，仍需正式审查/发布。
- Project overlay 包装 resolver 错误时会剥离已有领域前缀，用户文案不再出现双重 `STORYBOARD_PRESET_STALE`。
- `isEmptyObjectSchema()` 现在区分真正的空 object 与 union/composition schema。显式 `builtin.result.main({dataSchema})` 会在模型 schema 中把 `data` 标为 required，Harness 执行期也拒绝缺少 `data` 的终止调用。
- 角色 proposal 消费端恢复严格证据边界：只读取 `reportResult.data` 并立即按 `CharacterVisualDirectorProposalSchema` 校验；删除补造 `schemaVersion/operation/state/hash/character/outfits/diagnostics` 的未完成归一化。
- Global Model Settings 恢复 `illustration.director` 专用卡：支持清空/更换模型、定位 Provider、测试连接、测试/取消模型，并响应文生图入口的聚焦请求。Project scope 和通用 Profile 设置仍无第二编辑入口，保存继续原子写入 `agent.profiles["illustration.director"].model.modelKey`。

### 验证与计划差异

- TDD 红灯分别确认：已有 preset 跳过 companion、误置 candidate 不迁移、union 不暴露 data、缺 data 仍可终止、Global 设置卡缺失，以及错误码重复。
- 最终聚焦回归：Storyboard/init/overlay/resolver、report schema/control tool、Director assets、角色 proposal 共 `7 files / 51 tests passed`；Director 唯一入口合同 `1 passed`；模型草稿与健康检查 `2 files / 9 tests passed`，合计 61 项。
- 完整 `bun run typecheck` exit 0。
- 原安全合同仍指向已拆除的旧文生图侧栏实现；本轮按当前架构改为检查 `NovelIdeTextToImageSettingsPanel.vue` 的只读 Director 摘要，没有恢复旧分页 LLM/Provider 链。

## 2026-07-26 角色视觉 proposal 落盘与无角色正文生图

### 实际修复

- `WorkspaceCharacterVisualMigrationStore` 现在将 `projectPath` 和已解析的 Project Workspace `root` 作为同一上下文传入每次读写、索引失效与 CAS 写入。tracked writer 接收真实 target，不再把未等待的 Promise 当作参数，因此 proposal 完成后的控制文件可正常落盘。
- `illustration.director` 的 plan-chapter / plan-selection 契约明确规定：无已登记角色不是阻塞条件；此时 Shot 固定使用 `characterIds: []` 与 `action: {}`，仅可把当前 run 的 resolver terminal resolution ID 写入本 Shot 的 `tagDelta`。临时人物外观不得以自由 Tag 写入 DTO、不得创建角色档案，也不得跨镜头传播。

### 验证与计划差异

- 新增存储 target、Director Profile/Skill 与空角色编译三类红灯合同；实现后本轮新增的 29 项断言均通过。
- 同批执行的旧 UI 合同仍有 1 项失败：它要求已精简的 `NovelTextToImagePanel.vue` 直接挂载已迁移的角色视觉面板。这与本轮服务端落盘及临时 Tag 逻辑无关，未为使测试变绿而恢复已删除的侧栏入口。
- `bun run typecheck`、`bun run nuxt:build`、`bun run product:stage`、`bun run desktop:tauri` 与 `bun run desktop:assemble` 均成功。新的 Portable 位于 `dist/neuro-book-desktop-x64/NeuroBook.exe`，FileVersion/ProductVersion 均为 `0.7.4-canary.20260723.153500Z`，SHA-256 为 `1B3009A4590DA6392B32EFCF0A9CB91558922847693126C405AE95A08E6BDE0F`。
- 计划内三条根因修复均实现；额外收口了用户错误文案的重复领域前缀。按仓库规则未自动运行浏览器验证，也未提交、推送或发布。

## 2026-07-27 本地 TTP 词库系统化（Tag index 源硬切）

### 用户决策与边界

- 用户实测 Danbooru 官方在线拉取效果差，拍板三项决策：解密后的本地 TTP tagData 成为 Tag index 唯一数据源；tagData 随应用打包、首次启动自动导入激活；Danbooru 在线同步链路整条删除。中文 `translate` 字段本轮不纳入索引（Director 产出本就是英文 danbooru tag，中文搜索留作后续增强）。
- 背景：多智能体审查发现工作区存在未收编的调试改动——`getTagIndexRuntime()` 被偷换为 TtpSourceClient、builder/sync 校验被泛化放宽（"空即跳过"）、条款声明仍写着"不接收 TTP tagData"与实际源自相矛盾。本轮把这个 hack 系统化为正式合同，而不是回滚。

### 实际结果

- 合同诚实化：`sourceKind`/`sourceEndpoint` 硬切为 `ttp-local` / `local:ttp-tagdata`（shared literal，无 union、无兼容层）；`TAG_INDEX_TERMS_CONFIRMATION_VERSION` 改为 `ttp-local-terms-2026-07-v1`；manifest `sourceResponse.schemaVersion` 改为 `ttp-tagdata-v1`；条款声明重写为本地源事实，`termsUrl/attributionUrl` 保留 Danbooru 作为标签体系归属引用。
- 能力声明式校验：`TagSourceReader` 接口新增 `descriptor.providedResources`；snapshot/manifest 持久化该声明并在 schema superRefine 交叉校验（声明资源两轮 page 必须闭合，未声明资源必须零记录零 page）；sync `resourceHash` 与 builder `assertSourceCoverage`/`buildResourceManifest` 只对声明缺席的资源放行显式空占位，声明了的资源保持全部原有 fail-closed；回滚了两处"空即跳过"泛化放宽。
- `DanbooruSourceClient` 及其测试物理删除；reader 接口与记录类型移入中立 `tag-source-client.ts`。`TtpSourceClient` 收编：descriptor 声明只提供 tags、记录时间戳取 tagData 文件最大 mtime（同数据多次导入产出一致）、错误改用 `TagIndexError`、打包路径经 `resolveSystemNbookRoot()` 解析（生产安全）。
- runtime 默认源即 TtpSourceClient；`status()` 对旧 schema 的 active 工件按未激活处理（不再 throw），配合既有 `text-to-image-tag-index-boot.ts` 启动插件自动重导覆盖，老用户无感迁移。乱码注释与 BOM 清理，`import-ttp-tag-index.ts` 重写为干净 UTF-8 手动导入脚本。
- 打包：25 个 `danbooru_*.json`（11.8MB）进 `assets/workspace/.nbook/cache/text-to-image/ttp-tagdata/`；`isManagedAssetBlacklisted` 排除该目录（系统 `.nbook` 就地读取，不复制进每个用户 Workspace Root）；`product-runtime.mjs` 整体复制 `assets/workspace`，桌面端自动携带。
- UI：`TextToImageTagIndexSection.vue` 重写文案（移除条款确认仪式、"重新导入本地词库"、Alias/Implication 标注"源不提供"、tiers 计数展示、自动导入说明），挂载进 `NovelIdeTextToImageSettingsPanel.vue` 新"Tag 词库"section；新增 `tag-index-ui-contract.test.ts` 防再次静默脱挂。

### 设置面板问题修复（用户反馈）

- 高级开关（SMEA/SMEA Dyn/Variety/Decrisper/AI 默认角色位置）选中态改为 accent 边框+底色整体高亮，替代原来仅 3px 原生勾选框的不可辨状态。
- V4 系列模型下 SMEA Dyn 显示禁用态并附说明；模型切换到 V4 时自动清掉已存 `smeaDyn`/手动 SMEA，避免 Recipe 自动保存被服务端 `assertRecipeCapabilities` 422 拒绝形成报错循环。
- 参考资产上传修复前后端合同不匹配：服务端只从 multipart form parts 读 `projectPath` 与必填 `kind`，前端此前把 projectPath 放 query 且从不发 kind（必然 400）；现随表单发送并支持多选。缩略图 URL 从 `/{id}/content` 修正为服务端实际的 `{id}.content` 点路由。补充 Vibe 派生说明（vibe-encoding 由首次生图时服务端自动派生缓存，无需手动上传）。

### 验证

- tag-index 聚焦回归：`12 files / 49 tests passed`（含新增 `ttp-source-client.test.ts` 临时目录现场加密 fixture 的 5 用例）；`tag-index-ui-contract.test.ts` 通过。
- 已知残留（非本轮引入）：`character-visual-migration-ui-contract.test.ts` 仍 1 failed——角色迁移面板在此前"面板精简"重构中脱挂未收尾，属于审查报告 A1 项，待专门纵切挂回；`tag-index-runtime.test.ts` 与其他文件并行时偶发 Windows 文件锁半截 JSON 读竞争（预存时序问题，建议后续在 `tag-index-store.ts` 加读重试或原子写保护）。
- 按仓库规则未自动运行浏览器验证；未提交、未推送。

### 后续边界

- 审查确认的"面板精简"重构收尾仍待做：TextToImageCharacterMigrationPanel、TextToImageStoryboardImportPanel、TextToImageProjectOverlayPanel、NovelAiProviderReconciliation 四块零挂载组件需要重新安置或删除，Director 设置一键跳转事件链需重接。
- "三项配置直接上手"目标的其余项：默认 approved Tag Pattern companion（当前为空数组）、角色 registry 按需读取容错、Recipe 首开自动落盘、就绪检查聚合入口、placeholder 失败重试与 inserted 终态。

## 2026-07-27 chatu8 → TTP（text-to-picture）全仓品牌重命名

### 用户决策与边界

- 用户先要求移除文生图界面上的 chatu-8 字样，随后升级为全仓重命名：所有提到 chatu-8 的地方（含缩写 `c8` 家族）统一改为 TTP（text-to-picture）品牌。
- 明确保留的外部事实（改了会破坏功能或失真）：ST 导入 util 解析外部导出 JSON 的 key 数组 `["st-chatu8", "st_chatu8", "chatu8", "智绘姬"]`；`ttp-source-client.ts` 的开发环境回退路径 `.agent/st-chatu8/tagData`（上游仓库真实 clone 位置）；AES 密钥值；`danbooru_*` 外部格式名；spec 文档 9.6 节引用的真实用户样例文件名。

### 实际结果

- 文件/目录改名 16 项：`chatu8-storyboard-json/inspector/character-visual-source/source-client` 及各自测试 → `ttp-*`；`import-chatu8-tag-index.ts` → `import-ttp-tag-index.ts`；`text-to-image-st-chatu8-import.ts(+test)` → `text-to-image-st-ttp-import.ts`；skill 目录 `novel-import-chatu8-storyboard-preset` → `novel-import-ttp-storyboard-preset`；内置 companion 资产 `chatu8-cinematic.md`（storyboard + tag-pattern 两份）→ `ttp-cinematic.md`；打包数据目录 `cache/text-to-image/chatu8-tagdata` → `ttp-tagdata`；spec 文档改名为 `2026-07-17-ttp-storyboard-agent-illustration-design.md`（全部交叉链接同步）。
- 标识符与合同字面量硬切（无兼容层）：`Chatu8*`→`Ttp*`、`CHATU8_*`→`TTP_*`；环境变量 `CHATU8_TAGDATA_DIR`→`TTP_TAGDATA_DIR`；`chatu8-local`→`ttp-local`、`local:chatu8-tagdata`→`local:ttp-tagdata`、`chatu8-local-terms-2026-07-v1`→`ttp-local-terms-2026-07-v1`、`chatu8-tagdata-v1`→`ttp-tagdata-v1`、`nbook.chatu8-storyboard-inspect-manifest/v1`→`nbook.ttp-storyboard-inspect-manifest/v1`、`nbook.chatu8-storyboard-inspection/v1`→`nbook.ttp-storyboard-inspection/v1`、`nbook.chatu8-character-visual-source/v1`→`nbook.ttp-character-visual-source/v1`、`chatu8-character-export`→`ttp-character-export`、`chatu8_character_export`→`ttp_character_export`、source kind `chatu8`→`ttp`；ID 前缀 `chatu8-character-/chatu8-outfit-`→`ttp-character-/ttp-outfit-`（schema 正则与生成端同步）；archive 目录 `imports/chatu8-storyboard`→`imports/ttp-storyboard`（publish journal 路径模板同步）。
- `c8` 缩写家族全部换为 `ttp` 家族：稳定 ID 生成前缀 `c8i/c8p/c8e/c8pkg/c8recipe/c8pub/c8(rule|pattern)` → `ttpi/ttpp/ttpe/ttppkg/ttprecipe/ttppub/ttp`；测试 fixture 与内置资产身份字段（`ttppkg_01JQ6KX2NP`/`ttps_01JQ6KX2NP`/ruleId `ttp.*`）同步。
- Agent 面工具与资产：工具改名 `inspect_ttp_storyboard` / `submit_ttp_storyboard_conversion`（含 `^ttpi\.` importId 校验、Profile 提示词、allowlist）；`illustration.director.profile.tsx` 默认 storyboard title 改为 "TTP 电影化分镜预设"；`leader.assets.profile.tsx` skill include 同步。
- UI 文案恢复品牌：面板标题 "TTP Storyboard 导入"、"本地 TTP 词库（Danbooru 衍生数据）"、词库条款声明与失败诊断均以 TTP 措辞（条款 contentHash 运行时从文本计算，自动随文案更新）。
- **系统性删除**：`storyboard-preset-init.ts` 的"误置 candidate 纠正器"（`MISPLACED_*` 常量 + `isMisplacedCandidatePair`/`hasMisplacedIdentity`）整体移除——它靠字节级匹配旧品牌字样识别老版本写坏的 default.md，改名后永远匹配不到，属死代码；按"数据不做兼容"的仓库原则删除，对应测试用例一并删除。老安装若仍有误置 default.md 将走 `invalid-existing` 日志分支，不再自动纠正。
- 数据不兼容说明（快速开发期内可接受）：既有用户数据中的旧 importId/packageId/journal 路径（`imports/chatu8-storyboard/**`、`c8*` 前缀 ID）与新代码不再互认；旧 `chatu8-tagdata` 缓存目录变为孤儿数据，启动自动重导会以 `ttp-tagdata` 重建索引。

### 验证

- 多智能体（7 组改写 + 1 组对抗验证）执行；验证通过项：受管目录零 `chatu8` 文件名残留、零旧 import 说明符、`c8` 家族仅剩 `mock-data.ts` 的无关 `id:"c8"`、PROTECTED 项完整（解析 key 数组、回退路径、AES 密钥原样）、`ttp-cinematic.md` 两文件身份字段成对一致。
- `.compiled` profile 编译产物含旧工具名/字面量，已通过 `prepare-system-assets` 重新编译刷新（manifest 只引用新品牌 artifact，4 个旧 artifact 为待 GC 孤儿）；开发 Workspace Root 中旧名 skill 副本已删除（新名副本由资产同步带入）。
- 测试：改名核心 8 文件串行 34/34 通过（storyboard-import/publish service、tag-index 全链、preset-init、ttp-* 解析/inspector）；`shared` + `app/utils` 314/315（唯一失败在 `config.dto` Recipe 严格性，依赖用户未提交的 `shared/text-to-image-recipe.ts` WIP）；`server/agent/tools` 158/163（5 个失败在未修改的 file-tools/web-tools，环境相关）；`illustration-director-assets` 与 `builtin-tools-smoke` 通过。`server/text-to-image` 全目录并行跑存在大量超时/ENOTEMPTY 抖动（预存 Windows 文件锁问题，两次运行失败集不一致），串行复跑改名相关文件全绿；确定性失败均定位到用户 WIP 文件（`queue.service.ts` 已改未提交、`novelai-provider-discoverability-ui-contract.test.ts` 未跟踪新测试、面板脱挂即"面板精简"待收尾项）。
- typecheck：全仓仅 2 个 error，均在用户未跟踪的 WIP 新文件（`WorkspaceImage.ts`、`image.get.ts`）；改名引入 0 个类型错误。`server/agent/profiles` 全套件因机器过慢未在时限内完整跑完，仅跑了改名相关文件；建议空闲时补跑一次全量。
