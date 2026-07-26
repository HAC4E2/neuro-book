# Route B P5/P6 Advanced Reference + Candidate Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成冻结规格 P5/P6：高级标量继续沿唯一 Recipe→Snapshot→Compiler→Adapter 链贯通；图片参考、Vibe cache、Character Reference、Inpaint 以 Project 内容寻址资产进入相同执行闭包；同一 `illustration.director` 增加有界、只读的 `review-candidates` operation，用户显式决定是否把推荐候选提升为参考资产，永不自动重画。

**Architecture:** Recipe Markdown 仍是参考选择与 strength 的唯一可编辑真相；Project SQLite + `.nbook/text-to-image/references/` 保存按 SHA-256 寻址的图片/Mask/Vibe encoding 与 lineage。CompiledRequest 只冻结 reference content hash、模式和数值，不保存 Data URL/Base64/绝对路径；Project dispatch 在 App `attempt_started` fence 内按 hash 复验文件，必要时编码并持久缓存 Vibe，然后仅以内存 payload 调用 adapter。ProviderCapabilityRegistry 原位升级并负责模型兼容、组合冲突、数量/费用/Token 下限；不建立第二套 capability map。候选审阅使用同一 Director binding/Profile，以严格 review input/output 和 Project durable review 记录运行；候选图片作为有界 Pi image blocks 传入，Agent 无 Provider/Recipe/文件写/生成/reroll 工具。用户接受推荐只创建内容寻址 reference lineage，不改正文、不自动发送请求。

**Tech Stack:** TypeScript 5、Zod、TypeBox、Vue/Nuxt、Prisma 7 + Project SQLite、Vitest、现有 Agent Harness、Provider lane、Recipe/Compiler/AssetService。

## Frozen boundaries

- P5 不修改 TTP（text-to-picture）`tagData` 方向，不建立新 registry、浏览器/localStorage 参考资产真相或 Job Base64。
- AQT/UCP 分别由现有 `qualityToggle` 与 model-specific `ucPreset` wire 字段承载；P5 将它们正式纳入 capability/preflight 与等价性测试，不再新增语义重复的开关。
- Precise/Character Reference 首版仅允许已注册的 V4.5 model；Vibe 与 Precise Reference 组合 fail-closed。Vibe 最多 16 项；Character Reference 首版最多 1 项，避免多角色图片被 Provider 混合而产生虚假角色绑定。
- Inpaint 必须同时引用内容寻址 base image 与 PNG mask；CompiledRequest action 明确为 `infill`，adapter 才可派生已登记的 inpainting wire model。尺寸/模型/组合不兼容在 preview 阶段返回稳定错误，adapter 零调用。
- Vibe 编码是远端付费/可计费副作用，只能发生在已持久 `attempt_started` 后；缓存 key 固定覆盖 source content hash、model、informationExtracted 与 encoder version。缓存 miss 后若结果窗口不明，不自动重放。
- `review-candidates` 每次只接受同一 execution revision/manifest 的 2–8 个已登记图片；输出逐资产有界评分、理由、`selectedAssetId|null` 与 `noQualifiedReason|null`。推荐只读，用户选择可不同于推荐。
- 用户接受候选只提升为 Project reference asset 并记录 review/selection lineage；不替换正文图片、不改 Storyboard/Recipe、不 reroll。
- 不自动浏览器验证；真实付费 smoke 只在用户另行明确授权预算后执行。

### Task 1: P5 strict contracts and single capability registry

**Files:**
- Modify: `shared/text-to-image-provider-registry.ts` + tests
- Modify: `shared/text-to-image-recipe.ts`
- Modify: `shared/text-to-image-execution.ts` + tests
- Modify: Recipe codec/service/tests and fixtures

- [ ] **Step 1: RED — capability and strict Recipe V2**
  Cover versioned advanced capability, quality/UCP/Furry, Vibe/Character/Inpaint model compatibility, incompatible combinations, limits, cost/Token lower bounds, Recipe unknown-key rejection and source hash changes.
- [ ] **Step 2: Upgrade the existing registry and Recipe schema**
  Hard-cut Recipe to V2; add typed reference selections by content hash. `assertRecipeCapabilities` delegates to the registry preflight rather than maintaining a parallel model regex/map.
- [ ] **Step 3: Extend CompiledRequest/Manifest evidence**
  Add action/reference snapshots, reference hash contribution and known cost/token lower bounds. No bytes/path/Data URL fields are allowed.
- [ ] **Step 4: GREEN**

### Task 2: Project content-addressed reference assets and lineage

**Files:**
- Create: `shared/text-to-image-reference.ts` + tests
- Modify: `prisma/project.schema.prisma`
- Modify: `server/workspace-files/project-workspace.ts` + migration tests
- Create: `server/text-to-image/reference-asset.service.ts` + tests
- Create: reference asset list/upload/content/promote APIs and HTTP contract tests

- [ ] **Step 1: RED — content addressing, atomic file/DB pairing and lineage**
  Cover duplicate bytes convergence, PNG/JPEG magic/dimensions, PNG-only masks, size limits, tampered/missing file rejection, upload lineage, generated-asset promotion, and safe deletion while Recipe/review/cache references exist.
- [ ] **Step 2: Add Project models/upgrader**
  Add `TextToImageReferenceAsset`, `TextToImageVibeEncoding`, and typed lineage fields/indexes. Reference IDs are derived from content hash, not random browser IDs.
- [ ] **Step 3: Implement service and APIs**
  Multipart upload goes directly to a bounded server buffer, then atomic temp-file rename + DB create; generated promotion copies/verifies registered Asset bytes. API never accepts arbitrary Project-relative paths.
- [ ] **Step 4: Generate Project Prisma and GREEN**

### Task 3: Reference-aware compiler, adapter and paid-window cache

**Files:**
- Modify: `server/text-to-image/illustration-execution.compiler.ts`
- Modify: `server/text-to-image/illustration-compiler.ts` + tests
- Modify: `server/text-to-image/novelai-image-generation.ts` + tests
- Modify: `server/text-to-image/project-illustration-dispatch.ts` + tests
- Create: `server/text-to-image/reference-payload.service.ts` + tests

- [ ] **Step 1: RED — preview rejection and wire equivalence**
  Cover exact reference hashes in executionInputHash; missing/tampered assets; Vibe cache hit/miss; Vibe/Precise conflict; Character Reference model gate; inpaint base/mask/dimensions; exact wire fields; adapter receives bytes only in memory; Job/Manifest JSON contains no Base64.
- [ ] **Step 2: Compile strict reference snapshots**
  Execution compiler resolves Recipe hashes against Project records and freezes immutable metadata. Capability preflight computes extra cost/token lower bounds before signing preview.
- [ ] **Step 3: Resolve ephemeral payload after attempt fence**
  Project dispatch revalidates each content hash, reads bytes, encodes/cache-writes Vibe under the active attempt, then invokes adapter. Cache/write/remote ambiguity follows existing outcome-unknown policy.
- [ ] **Step 4: Extend exact adapter**
  Map only registered compiled snapshots; derive inpainting wire model/action and inject base64 at the last HTTP boundary. Response/Job evidence remains byte-free.
- [ ] **Step 5: GREEN and affected P4 regressions**

### Task 4: Reference UI as the only edit surface

**Files:**
- Create: `app/components/novel-ide/text-to-image/TextToImageReferenceSection.vue`
- Modify: `app/stores/text-to-image.ts` + tests
- Modify: `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`
- Add focused UI/HTTP contract tests

- [ ] **Step 1: RED — no local reference truth**
  Require page draft to contain only server reference DTOs/content hashes and Recipe draft; reject Data URL/vibeEncoding persistence and keep Director/Storyboard/body DTOs free of reference write fields.
- [ ] **Step 2: Add reference library + Recipe selectors**
  Upload/list/preview/promote assets, configure Vibe/Character/Inpaint strengths, display capability/conflict/cost diagnostics, and save only through Recipe service.
- [ ] **Step 3: Remove dead browser Vibe/Character draft helpers**
  Hard-delete prior page-only reference objects and encoding fields rather than adapting them.
- [ ] **Step 4: GREEN**

### Task 5: P6 strict candidate review contracts and durable service

**Files:**
- Create: `shared/text-to-image-candidate-review.ts` + tests
- Modify: `shared/agent/illustration-director.ts`
- Modify: `assets/workspace/.nbook/agent/profiles/builtin/illustration.director.profile.tsx`
- Modify: Project Prisma/upgrader
- Create: `server/text-to-image/candidate-review.service.ts` + tests
- Create: review start/read/select APIs + contracts

- [ ] **Step 1: RED — strict operation and same-revision closure**
  Cover 2–8 unique candidate IDs, same manifest/shot/compiled revision, strict scores/reasons/selection, no-qualified terminal, no NovelAI fields, missing Director binding, and exact resume/idempotency.
- [ ] **Step 2: Extend the same Director Profile**
  Add `review-candidates` Initial/Output schema and operation policy; tool whitelist is only `report_result`. Images are injected as ordered in-memory Pi image blocks; Profile has no generation/write/reroll/Provider tools.
- [ ] **Step 3: Implement durable review workflow**
  Create/reuse by candidate-set hash, persist session/invocation/result, recover interrupted runs, validate Agent output against exact candidate closure, and never create Job/Manifest/outbox.
- [ ] **Step 4: Implement explicit user selection**
  User submits expected review hash + selected asset ID; service records actor/reason and promotes the selected generated Asset through the reference service. It may differ from Agent recommendation.
- [ ] **Step 5: GREEN and compile system profile assets**

### Task 6: Candidate review UI and final Route B verification

**Files:**
- Modify: history/asset detail/workflow UI via a focused candidate review component
- Modify: `docs/tasks/text-to-image-panel/README.md`
- Modify: `PROJECT-STATUS.md`
- Modify: persistent planning files

- [ ] **Step 1: Add bounded candidate selection/review UI**
  Users select 2–8 assets from one revision, start/read review, compare scores/reasons, accept any candidate or finish with none. No auto-reroll button is introduced.
- [ ] **Step 2: Static ownership/error gates**
  Assert Profile/Skill/Storyboard/body APIs cannot write Recipe/reference strengths; stable capability/reference/review errors reach `resolveApiErrorMessage` exits.
- [ ] **Step 3: Full affected verification**
  Run Prisma generate, P5/P6 focused suites, P0–P4 affected regression, profile asset compile, route-old-chain/ownership gates, then full typecheck.
- [ ] **Step 4: Independent code review and docs**
  Resolve all Critical/Important findings. Record automated evidence, actual-vs-plan deviations and the unrun paid/browser acceptance.

## Final integration gate

Only after all tasks and the Route B completion matrix are green: inspect branch/remotes/staged scope, synchronize upstream without discarding user changes, resolve conflicts deliberately, commit only Route B task files, and push to `text-to-picture`. Never force-push or include unrelated worktree changes.
