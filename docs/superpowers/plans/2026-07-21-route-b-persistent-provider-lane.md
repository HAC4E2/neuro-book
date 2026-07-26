# Route B 持久 Provider Lane / Cross-DB Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 P4 Project outbox 接入 App DB 唯一、跨 Project、重启可恢复的 NovelAI Provider lane；所有远端 attempt 持久遵守至少 15 秒间隔、严格 credential revision、lease/fence、cross-DB preparation 与 paid-side-effect recovery。

**Architecture:** Project SQLite 继续拥有 immutable Manifest/approval/Job/CompiledRequest/Asset/lineage；App SQLite 只拥有 `DispatchPreparation`、`ProviderLaneItem` 与 `(ownerUserId,providerId)` throttle。授权先在 App 单事务创建 inert preparation/items，再在 Project 单事务注册带相同 prepare identity/version 的闭包，最后以 App CAS 提升为 ready。Worker 只消费 ready item，先 leased，再在 App 单事务持久 `attempt_started + throttle fence`，随后复验 Project closure 并调用只消费 strict CompiledRequest 的 NovelAI adapter。任何 `attempt_started` 后的不确定窗口只允许 `outcome_unknown/quarantined`，绝不自动回 ready。

**Tech Stack:** TypeScript 5、Zod、Nuxt/Nitro、Prisma 7 + App/Project SQLite、`@prisma/adapter-libsql`、Vitest、现有 Provider credential、AssetService 与 IllustrationResultService。

## Global Constraints

- lane key 固定为 `ownerUserId + providerId`；`effectiveIntervalMs = max(15_000, configuredRequestIntervalMs)`，同一 lane 最多一个远端请求在途。
- App preparation/item/throttle 是可恢复调度投影，不复制 CompiledRequest、Recipe 或 Provider secret；Project SQLite 始终是 Job/Manifest/请求/结果真相源。
- adapter 只消费 `IllustrationCompiledRequestSchema`；不得读取 Pattern/Markdown、重新组合 Prompt、重映射 sampler/seed 或隐藏 retry。
- `ready -> leased` 崩溃可恢复；`attempt_started` 后崩溃、timeout、网络断开或结果无法证明时只能 outcome unknown/quarantine。
- Project 关闭不能阻止 reconciler；Project 移动/暂不可达时隔离，不把“暂时没看到 Job”误判为 abandoned。
- Provider token 真正变化才递增 `credentialRevision`；同值重加密保持 revision。未开始的旧 revision item/Job 进入 configuration stale，在途 attempt 按原结果收尾。
- 不建立浏览器/localStorage lane 或 15 秒锁；UI 只显示服务端 Job/lane 投影。多个快速点击立即注册 queued。
- 不自动做浏览器验证；不提交、推送、发布或改变现有暂存状态。

---

### Task 1: Strict App dispatch contracts, schema and migrations

**Files:**
- Create: `shared/text-to-image-dispatch.ts`
- Create: `shared/text-to-image-dispatch.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/schema.sqlite.prisma`
- Create: `prisma/migrations/20260721220000_text_to_image_persistent_lane/migration.sql`
- Create: `prisma/migrations/sqlite/20260721220000_text_to_image_persistent_lane/migration.sql`
- Create: `server/text-to-image/dispatch-schema-migration.test.ts`

**Interfaces:**
- `DispatchPreparation`: stable preparation ID/manifest identity, owner/provider/revision, portable projectId + current projectPath, `prepareAttemptId/prepareLeaseUntil/prepareVersion/stateVersion`, state and quarantine evidence.
- `ProviderLaneItem`: unique dispatchKey/jobId projection, exact preparation version, `prepared|ready|leased|attempt_started|completed|failed|outcome_unknown|quarantined`, send attempt/fence/lease and stable error.
- `ProviderThrottle`: unique owner/provider row with `nextAllowedAt/activeAttemptId/leaseUntil/fencingVersion`; never reset on credential replacement.

- [x] **Step 1: Write strict schema/migration RED**

Cover invalid state combinations, owner/provider/project/manifest mismatch, no CompiledRequest/secret fields in App models, real SQLite migration and uniqueness/indexes.

- [x] **Step 2: Run RED**

Run: `bunx vitest run shared/text-to-image-dispatch.test.ts server/text-to-image/dispatch-schema-migration.test.ts`

- [x] **Step 3: Add both App schemas and SQL migrations**

Use explicit Prisma enums/models and relations only where deletion semantics are safe. Historical dispatch/attempt evidence must not depend on Provider row survival. SQLite migration is authoritative runtime migration; root SQL remains distribution parity.

- [x] **Step 4: Generate and run GREEN**

Run App Prisma generate, then Step 2. Expected: schema parse and real SQLite constraints pass.

### Task 2: Stable registration projection and cross-DB preparation saga

**Files:**
- Modify: `shared/text-to-image-execution.ts`
- Modify: `server/text-to-image/execution.repository.ts`
- Modify: `prisma/project.schema.prisma`
- Modify: `server/workspace-files/project-workspace.ts`
- Create: `server/text-to-image/dispatch-preparation.repository.ts`
- Create: `server/text-to-image/dispatch-preparation.repository.test.ts`
- Create: `server/text-to-image/illustration-registration.coordinator.ts`
- Create: `server/text-to-image/illustration-registration.coordinator.test.ts`
- Modify: `server/text-to-image/illustration-execution.service.ts`
- Modify: affected execution tests/API receipt UI.

**Interfaces:**
- Export one deterministic registration projection from the existing registration validator; App and Project repositories must consume the same jobId/dispatchKey set rather than rederive parallel formulas.
- Project outbox adds non-null-for-v2 `preparationId/prepareAttemptId/prepareVersion`; registration version hard-cuts to v2.
- Registration receipt adds `dispatchState: ready|dispatch_pending`; Project registration truth remains `jobs_registered`.

- [x] **Step 1: Write cross-DB crash-matrix RED**

Cover App prepare batch all-or-none, Project failure leaves inert items, Project commit + ready CAS failure returns same receipt/dispatch_pending, repeated authorize converges, old prepare version cannot become sendable, and prepare lease expiry blocks late commit.

- [x] **Step 2: Implement App prepare CAS and deterministic projection**

App transaction validates current singleton Provider/revision, creates one preparation + all inert items, and returns an existing exact closure on duplicate authorization. `abandoned` rearm reuses preparation/dispatch/job identities and increments prepareVersion; active/quarantined states cannot be overwritten.

- [x] **Step 3: Stamp Project transaction and finalize ready**

Project transaction has a hard timeout shorter than prepare lease and checks lease before commit. App finalization CAS verifies attempt/version and exact dispatch set; no compensating deletion of committed Project truth.

- [x] **Step 4: Run GREEN and Project generate**

Run focused repository/coordinator/execution tests plus Project migration tests.

### Task 3: Project-independent preparation reconciler

**Files:**
- Create: `server/text-to-image/project-dispatch.repository.ts`
- Create: `server/text-to-image/project-dispatch.repository.test.ts`
- Create: `server/text-to-image/dispatch-reconciler.ts`
- Create: `server/text-to-image/dispatch-reconciler.test.ts`

**Interfaces:**
- Ephemeral Project access resolves Project DB without requiring an open Project session and always closes handles.
- Resolver first tries stored projectPath, then may relocate only by exact `ProjectMetadata.projectId`; zero/multiple matches quarantine.
- Reconciler claims expired preparations by App CAS. Exact Project closure promotes ready; no commit becomes abandoned; unavailable/moved/deleted becomes quarantined. It never sends.

- [x] **Step 1: Write recovery RED**

Cover active lease no-op, expired exact commit promotion without opening Project, truly absent commit abandoned, unavailable Project quarantine, exact projectId relocation, ambiguous relocation quarantine, late old-version outbox rejection and exact rearm.

- [x] **Step 2: Implement ephemeral Project reader/rebinder**

Read only metadata/Manifest/approval/Job/outbox identities. Rearm may update outbox prepare identity only after the immutable closure is exact; it cannot create a new Job.

- [x] **Step 3: Implement bounded App scan and CAS recovery**

Every item failure is isolated so one damaged Project cannot stop the user/provider lane. Reconciler exposes a single `runOnce(limit)` for plugin and tests.

- [x] **Step 4: Run GREEN**

Expected: recovery needs no Project open call and never turns missing/unavailable into a paid request.

### Task 4: Persistent throttle, lease/fence and lane state machine

**Files:**
- Create: `server/text-to-image/provider-lane.repository.ts`
- Create: `server/text-to-image/provider-lane.repository.test.ts`
- Create: `server/text-to-image/provider-lane.worker.ts`
- Create: `server/text-to-image/provider-lane.worker.test.ts`

**Interfaces:**
- `claimReady`: `ready -> leased` only, one item per owner/provider lane.
- `startAttempt`: one App transaction validates provider revision, enforces `now >= max(nextAllowedAt,lease boundary)`, assigns new attemptId, increments throttle fence, writes `attempt_started`, `leaseUntil`, `nextAllowedAt` and attempt count.
- `recoverExpired`: leased/no attempt -> ready; attempt_started -> terminal mirror or outcome unknown, never ready.

- [x] **Step 1: Write concurrency/time RED**

Cover two coordinators CAS, cross Project ordering, configured 0 => 15s, configured 30s => 30s, long request no overlap, throttle survives service restart, leased crash safe retry, attempt_started crash unknown, empty lane cleanup.

- [x] **Step 2: Implement repository transactions with owner/provider lock**

Use App DB transaction/CAS and the existing DatabaseLock convention. Persist timestamps as DateTime; no in-memory timestamp is authoritative.

- [x] **Step 3: Implement one-item worker orchestration seam**

Worker receives ports for Project validation/send/result so state-machine tests do not need network. It must release/terminalize only with matching attemptId/fence.

- [x] **Step 4: Run GREEN**

Expected: all initial attempts and retries pass through the same persistent throttle.

### Task 5: Strict CompiledRequest NovelAI adapter and Project result integration

**Files:**
- Modify: `server/text-to-image/novelai-image-generation.ts`
- Modify: `server/text-to-image/novelai-image-generation.test.ts`
- Create: `server/text-to-image/illustration-dispatch.worker.ts`
- Create: `server/text-to-image/illustration-dispatch.worker.test.ts`
- Modify: `server/text-to-image/asset.service.ts` only if an exact worker seam is required.

**Interfaces:**
- `requestCompiledNovelAiImage(request, credential, signal)` parses self-hashed CompiledRequest and creates exact wire data. No random seed, style merge, prompt rule, sampler mapping, character re-extraction or hidden retry.
- Dispatch worker revalidates Project Job/approval/Manifest/outbox/provider revision/prepare version/compiled hash before App `attempt_started`, again before adapter call, and writes Project `running -> completing -> result service` with exact attempt fence.

- [x] **Step 1: Write wire-equivalence and paid-window RED**

Cover exact v4 prompt/negative/character prompts/UC/parameters, adapter call count zero on any stale fence, successful Asset/result insertion, explicit HTTP 429/5xx retry policy through new lane attempt, network timeout/abort outcome unknown, Project result then App crash reconciliation.

- [x] **Step 2: Implement exact adapter**

Share only low-level request/zip parsing helpers with the manual path. The CompiledRequest path may not call the manual prompt builder.

- [x] **Step 3: Implement production Project port**

Use ephemeral Project access for background work; do not require the Project to be open. Save Asset under Project-relative path, keep late/missing assets, and invoke `IllustrationResultService` with the App fence.

- [x] **Step 4: Run GREEN**

Expected: a ready Project job reaches canonical Markdown at most once; all uncertain windows preserve billing safety.

### Task 6: Credential revision replacement and stale invalidation

**Files:**
- Modify: `server/text-to-image/provider.service.ts`
- Modify: `server/text-to-image/provider.service.test.ts`
- Modify: `server/text-to-image/provider.service.sqlite.test.ts`
- Create/Modify: dispatch credential reconciliation service/tests.

**Interfaces:**
- Existing credential is decrypted only inside owner mutation to compare submitted plaintext. Same token may re-encrypt but preserves revision; different token increments once.
- The same App transaction marks all not-started old revision preparations/items quarantined with `TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE`; throttle row is untouched. In-flight attempt_started keeps its fence and resolved credential.
- Project reconciler marks matching queued Jobs `configuration_stale`; running/completing jobs are not resent and uncertain ones become outcome unknown.

- [x] **Step 1: Write revision/race RED**

Cover name/interval update, same token, different token, provider-save vs lane-start owner lock, queued old revision, in-flight old revision, and preserved throttle.

- [x] **Step 2: Implement atomic App invalidation and Project propagation**

Worker independently revalidates current revision before every start, so Project propagation lag can never send stale credentials.

- [x] **Step 3: Run GREEN**

Expected: no silent account switch and no reset of the 15-second clock.

### Task 7: Boot worker, observable status, verification and docs

**Files:**
- Create: `server/plugins/text-to-image-provider-lane.ts`
- Create: plugin lifecycle test.
- Modify: placeholder/history DTO/UI only for server-owned queue/dispatch status needed by users.
- Modify: `docs/tasks/text-to-image-panel/README.md`
- Modify: `PROJECT-STATUS.md`
- Modify: persistent planning files.

**Interfaces:**
- Nitro plugin starts a bounded periodic `reconcile -> recover expired -> drain` loop after boot and stops/aborts on close. Timers are not truth; each tick is safe to duplicate across coordinators.
- UI shows queued/running/configuration stale/outcome unknown from Project/App projection and never implements a client-side 15-second lock.

- [x] **Step 1: Add plugin lifecycle and status RED**

Cover non-blocking boot, close cleanup, tick overlap prevention without global correctness dependence, one bad item isolation and no browser lane truth.

- [x] **Step 2: Implement production assembly**

Bound work per tick, structured logs only, hard adapter timeout, AbortController per attempt, and graceful stop. No automatic browser verification.

- [x] **Step 3: Run full lane/P4 affected suites**

Include App/Project migration, cross-DB crash matrix, concurrency/time, exact adapter/result, Provider replacement, P4 registration/status and typecheck.

- [x] **Step 4: Update actual-vs-plan evidence**

### Actual-vs-plan note

- 凭证替换的 App 原子失效按计划实现，但 Project DB 不可能与 App DB 共享事务。实际新增 `TextToImageProviderRevisionInvalidation` 持久 saga：设置保存先在 App owner transaction 内递增 revision、隔离未发送项并记录 saga；Project 逐库传播成功后才关闭，失败则保留错误与 attemptCount 供 Nitro tick 重放。这是对跨库恢复缺口的系统性补齐，不是兼容层。
- Task 7 没有新增浏览器 lane DTO 或本地倒计时：既有 Project Job status 已完整表达 queued/running/configuration_stale/outcome_unknown，页面与历史面板已经消费这些服务端状态。新增 App lane 只保存调度身份、lease/fence 与错误证据。
- 生产 runtime 的实际顺序为 preparation reconcile → credential revision saga → expired lease/attempt mirror → bounded dispatch → idle throttle cleanup。每阶段独立记录结构化错误；进程内 non-overlap 只减少重复扫描，正确性仍由 App CAS/owner lock/lease/fence 保证。

Record every crash window, retry policy, plan deviation and any known environment-only test timing. Do not claim browser acceptance without authorization.

### Review closure

- [x] 429 / 5xx 通过持久 `retry_wait` / `retry_leased` 显式建立新 attempt，并继续服从同一 Provider throttle；adapter 内不做隐藏重试。
- [x] `attempt_started` 与本次请求使用的解密凭据在同一 owner transaction 内线性化；凭据只在内存中交给 dispatch，不写入 lane。
- [x] credential revision saga 按失效 lane 的精确 `projectId + projectPath` 闭包逐目标持久化；Project 暂不可达时不得提前完成。已完成 saga 遇到同 Project 的后发 in-flight 503 会重新置为 pending。
- [x] App / distribution SQLite migration 为 claim、send、error、throttle、revision saga 状态组合补齐 CHECK；聚焦测试覆盖非法组合。
- [x] 晚到的旧 prepareVersion Project commit 可在下一次 authorize 时立即原子 rebind，不依赖 lease 扫描器。
- [x] Nitro close 主动中止在途 HTTP 请求，global runtime 以 app owner 引用计数管理；ready 扫描在 SQLite 查询层排除 busy/throttled lane 后再做全局排序，不存在固定扫描窗口饥饿。
- [x] 已重新运行聚焦回归、lane/P4 受影响回归、Prisma generate 与 typecheck，并据实更新本计划、walkthrough 和 `PROJECT-STATUS.md`；最终独立定向复核无 Critical/Important，Ready verdict 为 Yes。

## Self-review

- Single truth: App models contain only dispatch identities/state; Project owns request and results; Provider owns credential; Recipe remains Markdown. No field is editable in two domains.
- Paid safety: `attempt_started` is persisted before adapter; this intentionally prefers outcome unknown over possible duplicate billing in the narrow pre-call crash window.
- Cross-DB honesty: no fake transaction or compensating deletion. `dispatch_pending` truthfully reports Project commit with App promotion pending.
- Recovery: all scans originate from App preparations/items, so Project need not be open. Relocation is exact projectId-only and ambiguity quarantines.
- Type boundary: all persisted JSON is parsed with strict shared schemas; no `Record<string, unknown>`, `any` or compatibility parser is introduced.
- Execution mode: continue inline through each task; no commit/push/release/browser step is included.
