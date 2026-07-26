# Route B P2 Danbooru Tag Index / Policy / Resolver Implementation Plan

> **执行约束：** 本计划接续已完成的 `pending_unresolved` import foundation，按 `test-driven-development` 逐项 RED/GREEN。用户已授权 Prisma generate、聚焦测试与 typecheck，但本纵切不需要 Prisma schema；禁止浏览器自动验收、提交、推送与发布。

**Goal:** 实现用户显式触发、可恢复且 fail-closed 的 Danbooru 官方 3K+ 同步，构建四层不可变 JSON + SQLite FTS active index；在官方 facts 之外建立版本化 TagPolicyRegistry，并让 Importer 只通过终态 Resolver snapshot 从 `pending_unresolved` 推进到可审查的 `pending`。

**Architecture:** `DanbooruSourceClient` 是唯一联网边界，只接受固定官方 HTTPS host，以 ID cursor、冻结 watermark、持久 page cache 与第二轮 reconciliation 生成严格 source snapshot。`TagIndexBuilder` 在新的 staging 目录把 snapshot 规范化成 tier/relations/SQLite/report，校验完成后先发布不可变 version 目录，最后以 expected-hash CAS 替换 `current.json`。运行时只通过只读 `TagIndexReader` 查询 SQLite；`TagPolicyRegistry` 与 Project `.nbook/config.json` 的 scope 独立于官方事实；`TagResolverService` 复用 P0 `SemanticTagResolution` 三终态合同。浏览器只显示服务端 operation/status，不持久化事实副本。

**Hard boundaries:**

- 唯一上游是 `https://danbooru.donmai.us` 官方 JSON API；不接受请求传 source URL，不设计通用 source adapter。
- 固定 inclusive `minPostCount=3000`。主集合是未 deprecated 的全部 category 3K+ Tag；deprecated 3K+ 仅作解析证据。
- 所有主 canonical 的 active Alias、至少一端属于主集合的 active Implication 必须闭合；低频另一端只作 auxiliary endpoint。
- live API 无 snapshot isolation：先冻结 Tags/Aliases/Implications watermarks，首轮后再做完整 reconciliation；任一差异未闭合不得 ready/active。
- 两轮同步均使用 `page=a<ID>` 的 ID cursor；逐页验证 ID 单调、无重复、无空洞式 cursor 回退，记录 page hash/bytes/content type。
- 429 尊重合法 `Retry-After`，5xx/超时有界退避；所有请求串行并带最小间隔。持续失败、取消或 schema drift 保留旧 active。
- JSON tiers 是审查/重建工件；runtime search/validate/Compiler 只经受控 reader 查询 `tags.sqlite`，Agent 不获得文件/数据库句柄。
- 不加载 sqlite-vec、不生成 embedding。首版候选仅用 exact/alias、token/FTS、官方关系与有界概念查询。
- TagPolicyRegistry 不改写 Danbooru facts。`block` 永不暴露，`review_required` 不自动进入 Agent；Project 只选择 scope 与 unknown policy。
- TTP（text-to-picture）Storyboard 只能成为 resolver input；不得写官方 index、不得恢复 `tagData`、不得创建浏览器/localStorage 第二真相源。

## Task 1: Shared index, policy and resolver contracts

**Files:**

- Create: `shared/text-to-image-tag-index.ts`
- Create: `shared/text-to-image-tag-index.test.ts`
- Create: `shared/text-to-image-tag-policy.ts`
- Create: `shared/text-to-image-tag-policy.test.ts`
- Create: `shared/text-to-image-tag-resolver.ts`
- Create: `shared/text-to-image-tag-resolver.test.ts`

**RED/GREEN:**

- 定义官方 category、四个 usage tier 与 `2999/3000/9999/10000/29999/30000/99999/100000` 硬边界。
- 定义 normalized main/deprecated Tag、Alias、Implication、auxiliary endpoint、page provenance、source snapshot、manifest、build report、active pointer 与 install operation strict schema。
- manifest 强制三资源 watermark/页数/首末 ID/record count/reconciliation hash、terms confirmation、工件 count/hash 与 SQLite/FTS 校验摘要。
- 定义 TagPolicyRegistry 的 `allow|review_required|block`、provenance、Project `contentScope/unknownTagPolicy` 与 effective decision evidence。
- 定义 resolver run 的 `created -> terminal_canonical` 或 `pending_unknown -> candidates_ready -> terminal_*` 判别联合、候选 evidence、candidateSetHash 与有限 search/validate DTO。
- 所有 runtime terminal 输出直接嵌入现有 `SemanticTagResolutionSchema`；pending/candidate 不能 parse 成持久 snapshot。
- DTO 不出现 Recipe、NovelAI sampling/size/seed、secret、任意 URL 或文件路径 mutation 字段。

## Task 2: Fixed official source client

**Files:**

- Create: `server/text-to-image/tag-index/danbooru-source-client.ts`
- Create: `server/text-to-image/tag-index/danbooru-source-client.test.ts`
- Create: `server/text-to-image/tag-index/tag-index-error.ts`

**RED/GREEN:**

- 固定 `/tags.json`、`/tag_aliases.json`、`/tag_implications.json` 和已登记 query 参数；fetch 使用 `redirect: "error"`，不读取调用方 URL。
- official JSON row 采用“必需字段严格、未知附加字段容忍”：Tag 必须有 `id/name/category/post_count/is_deprecated/created_at/updated_at`，关系必须有 `id/antecedent_name/consequent_name/status/created_at/updated_at`。
- 必需字段缺失、类型变化、非 active relation、unsafe integer、重复 ID、响应非 JSON/content-type 错误、page bytes 超限映射稳定错误码。
- 用 `a<ID>` cursor 串行遍历，页面内部接受官方响应顺序但规范化为 ID ASC，并验证 `id > cursor && id <= watermark`；下一 cursor 只能是本页最大 ID。
- 429 解析整数秒或 HTTP-date `Retry-After`；5xx/timeout 使用有界指数退避；4xx、重试耗尽与取消分别映射 `RATE_LIMITED/UNAVAILABLE/SCHEMA_CHANGED/SYNC_INCOMPLETE`。
- tests 只用注入 fetch/clock/sleep fixture，不在自动化中抓取生产 API。

## Task 3: Persistent sync operation and source snapshot

**Files:**

- Create: `server/text-to-image/tag-index/tag-index-store.ts`
- Create: `server/text-to-image/tag-index/tag-index-store.test.ts`
- Create: `server/text-to-image/tag-index/tag-index-sync.service.ts`
- Create: `server/text-to-image/tag-index/tag-index-sync.service.test.ts`

**RED/GREEN:**

- 唯一路径解析为 Workspace Root `.nbook/cache/text-to-image/tags`；生产路径不接受 HTTP 提交，测试只通过构造参数注入 root。
- sync operation 使用 create-only lock + lease/state journal；同 root 两个 start 合并为同 operation，跨 service instance 不重复同步。
- staging 固定保存 `operation.json`、已验证 source pages 与 page manifest；每页写入后再推进 cursor，进程重启从最后完整 page 恢复。
- 开始时分别冻结 Tags/Aliases/Implications upper watermark；首轮完整遍历后执行第二轮完整 reconciliation。两轮 canonical page/record hash 不一致时，按同 watermark 重试有界 reconciliation；仍不一致则 failed。
- 取消只在安全 checkpoint 生效；failed/canceled operation 永不写 `current.json`。旧 active status/read 始终可用。
- operation 日志不保存 secret、Cookie、认证 header 或任意用户 source URL。

## Task 4: Deterministic normalization and closure

**Files:**

- Create: `server/text-to-image/tag-index/tag-index-normalizer.ts`
- Create: `server/text-to-image/tag-index/tag-index-normalizer.test.ts`

**RED/GREEN:**

- main/deprecated 3K+ 分离；所有官方 category 保留；canonical name/ID conflict、重复 record 内容漂移 fail-closed。
- 只保留 consequent 属于 main canonical 的 active Alias；alias antecedent 不受 3K 阈值。alias chain/cycle、同 antecedent 多 consequent 视为 source conflict。
- 只保留至少一端属于 main 的 active Implication；另一端生成 auxiliary endpoint，不进入普通 suggestions。
- tier 边界、稳定排序 `postCount DESC, canonicalName ASC, tagId ASC`；每个 main Tag 恰好一个 tier。
- normalized snapshot hash 与 indexVersion 由官方事实、source provenance、builder/source client/threshold/policy-independent schema version单向派生；不含本地路径/时间审计字段。

## Task 5: Four-tier artifacts and SQLite FTS builder

**Files:**

- Create: `server/text-to-image/tag-index/tag-index-database.ts`
- Create: `server/text-to-image/tag-index/tag-index-builder.ts`
- Create: `server/text-to-image/tag-index/tag-index-builder.test.ts`

**RED/GREEN:**

- 复用 Bun `bun:sqlite` / Node `node:sqlite` 双 runtime，禁用 extension/vec；创建 main/deprecated tags、aliases、implications、auxiliary endpoints、metadata 与 FTS5 查询面。
- staging 生成四 tier JSON、aliases/implications JSON、`tags.sqlite`、build-report 与 source-manifest；所有 JSON canonical render 并记录 bytes/hash/count。
- SQLite 外键、unique、main/tier/alias/endpoint closure、FTS row count、metadata hash 与 JSON counts 必须一致；数据库 `integrity_check`、`foreign_key_check`、固定抽样 exact/alias/FTS 查询全部通过。
- builder 失败关闭 handle，保留 diagnosable failed staging，不生成 ready marker。
- 成功后把 staging rename 为不可变 `<indexVersion>/`；已存在同 version 时逐工件 hash 相同才幂等，否则 conflict。

## Task 6: Expected-hash activation and active reader

**Files:**

- Extend: `server/text-to-image/tag-index/tag-index-store.ts`
- Create: `server/text-to-image/tag-index/tag-index-reader.ts`
- Create: `server/text-to-image/tag-index/tag-index-reader.test.ts`

**RED/GREEN:**

- `current.json` 最后发布；activation 在锁内复读 expected current hash，temp file fsync 后同目录 rename。expected hash 漂移返回 `TAG_INDEX_ACTIVATION_CONFLICT`。
- absent/损坏/current 指向缺失或 manifest/hash/SQLite 不匹配均返回 `TAG_INDEX_NOT_READY`，不扫描目录猜 active 版本。
- reader 每次从 active pointer 打开只读 SQLite并在 finally close；查询 evidence 固定携带 indexVersion/manifestHash/queried tiers/candidateSetHash。
- exact canonical / exact alias 跨全库优先；deprecated evidence 不作为正常建议。prefix/FTS 先检索 core+high，不足再 common/tail，但最终按 match quality 优先、tier/postCount 只作同质量 tie-break。
- alias/validate/Compiler helper 始终查全库；related 只返回 policy 前的 official facts，不把 auxiliary endpoint伪装成 main candidate。

## Task 7: Project policy truth source

**Files:**

- Modify: `server/config/types.ts`
- Modify: `shared/dto/config.dto.ts`
- Modify: `server/config/normalizer.ts`
- Modify: `server/config/config-service.ts`
- Modify focused config tests and settings payload builders that otherwise erase the new field.
- Create: `server/text-to-image/tag-index/tag-policy-registry.ts`
- Create: `server/text-to-image/tag-index/tag-policy-registry.test.ts`

**RED/GREEN:**

- Project `.nbook/config.json` 新增唯一 `illustration.tagPolicy`：固定 content scope 与 `unknownTagPolicy=provider_passthrough|review_required`；默认 passthrough。
- existing Global/Project settings saves preserve this field；Project 无自定义 rule editor，Global model binding 与 NovelAI/Recipe ownership不变。
- 内置 registry 使用版本化静态规则与 provenance；exact name/pattern 决策稳定，block 优先级最高。
- query automatic exposure 过滤 block/review_required；explicit import diff 可显示 review_required，但需要绑定 Tag/policyVersion/source 的 approval evidence。
- policy 收紧后 validate 立即 fail-closed；旧批准不覆盖新 policyVersion。

## Task 8: Terminal resolver core

**Files:**

- Create: `server/text-to-image/tag-index/tag-resolver.service.ts`
- Create: `server/text-to-image/tag-index/tag-resolver.service.test.ts`

**RED/GREEN:**

- exact main canonical 和 exact active alias 直接返回唯一 terminal canonical snapshot；deprecated/block/review 分别走受控 evidence/error。
- unknown 先生成 run-scoped resolutionId；candidate recall 只来自 main set，融合 token/FTS、alias/implication evidence 与最多 4 个有界英文 conceptQueries。
- semantic cluster、threshold/margin 与最终排序参数由版本化 `TagResolverPolicy` 固定；明显更相关的 common/tail 不被弱 core 压过，同质量簇内按 compatibility/tier/postCount/name 稳定选择。
- `finalize` 不接受 candidateTagId，只选择 eligible rank 1；无 reliable candidate 时调用既有 sanitizer 生成 terminal passthrough。
- resolution run/candidateSet 的 stale、跨 run、index/policy/capability/model scope 漂移 fail-closed；finalize 幂等返回同 terminal ref。
- `user_override` 另走 actor/reason/approval/expected hash 命令，只允许 eligible 集并记录原 top/selected rank。

## Task 9: Resolve pending import and approval boundary

**Files:**

- Extend: `server/text-to-image/storyboard-import.service.ts`
- Extend: `server/text-to-image/storyboard-candidate.service.ts`
- Extend: `shared/text-to-image-storyboard-import.ts`
- Add focused import/service tests.

**RED/GREEN:**

- active index 出现后，显式 resolve operation 把全部 PendingTagAtom 送入同一 run/context；每个 atom 必须得到 terminal canonical/replacement/passthrough 或 policy review/block。
- terminal snapshots 写入正式 `TagPatternSetSchema`；pending/candidate ref、自由 Tag 字符串或跨 owner resolution key 全部拒绝。
- resolved candidate 重算 Pattern planning/render、package hash 与 preview token；旧 pending preview/approval token 失效。
- block 阻断 package；review_required 只在 explicit diff 中逐项批准；普通无候选安全文本保存 passthrough。
- 本 Task 只把 candidate 推到 `pending` 并开放可审查 approval eligibility；global pair publish journal/selector 作为紧接下一计划，不能绕过 index/Resolver。

## Task 10: User-triggered API and settings UI

**Files:**

- Create API under `server/api/text-to-image/tag-index/` for status/start/cancel/search.
- Create: `app/components/novel-ide/text-to-image/TextToImageTagIndexSection.vue`
- Modify: `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue` only as host.
- Remove old Tag Vocabulary/tagData UI/store/parser consumers once official section owns the surface; do not keep an adapter.

**RED/GREEN:**

- 首次/重建同步必须由用户点击并确认当前 terms/attribution version；打开页面不联网。
- UI 只轮询服务端 operation/status，显示 active version、watermark、阶段、page/count、rate-limit retry、失败诊断与旧 active continuing；不保存 source/index副本。
- 两次点击返回同 operation；cancel/failed 后旧 active 仍可 search。
- import panel 在 active ready 时显示 resolve action与三类 diff；无 active 时仍保持 approval disabled。
- `tagData` 下载/目录导入/Base64/AES/enrichment/export 的 API、UI、store、source registry 和测试引用归零。

## Task 11: Verification, review and bookkeeping

- 逐 Task 运行聚焦 Vitest；完成后运行 Tag index/Resolver/import/config 组合回归与 `bun run typecheck`。
- 本纵切无 Prisma schema 变化；不运行无意义 generate。若实施中发现必须持久化到 App/Project DB，先停止并重审架构，不临时塞 Json 字段。
- 静态检查 source host/URL、Tag data、Recipe/Provider/NovelAI scalar 权限边界；确认 Agent/Profile/Skill 不获得 index写入或 Project policy mutation。
- 更新同一 `docs/tasks/text-to-image-panel/README.md` 与 `PROJECT-STATUS.md`，报告实际结果、计划偏差、性能取舍与仍待 global publish/overlay/角色 migration 的 P2 边界。
- 使用 `requesting-code-review` 做独立只读审查并闭合 P0/P1 后，再把 P2 后续切到 global pair publish/Project overlay/角色与服装 V2 migration。
- 不自动运行浏览器验证；只在用户另行授权后做真实 UI/Project 验收。
