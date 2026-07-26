# Route B P4 Planning 发布与确定性执行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 P3 validated Shot Intent 可恢复地发布为 `illustrations.md` 与 V2 Prompt Placeholder，并建立无副作用 preview、确定性 Compiler、原子 Manifest/approval/Job/outbox 注册、精确结果替换和旧正文链硬切。

**Architecture:** Chapter Storyboard Markdown 是镜头语义真相源，正文 V2 placeholder 只保存引用，Project SQLite 分别保存 Planning Apply Journal 与不可变执行注册。Compiler 每次从当前服务端真相源重建 CompiledRequest；preview 零写入，授权 POST 用同一签名 nonce 重算并在 Project 单事务注册。P4 只产生可供 App 持久 lane 消费的 outbox，不把新按钮回接旧进程内 Queue；下一阶段负责跨 Project preparation/lane/fence。

**Tech Stack:** TypeScript 5、Zod、YAML strict frontmatter、Nuxt/Nitro、Vue 3/TipTap、Prisma 7 + SQLite、Vitest、现有 tracked workspace writes 与 Project-open guard。

## Global Constraints

- 不读取、下载、适配或预留 TTP（text-to-picture）`tagData`。
- Agent/Profile/Skill/Storyboard/正文按钮不得写 Provider、Recipe 或 NovelAI 参数；执行事实只能由服务端读取当前真相源。
- `illustrations.md`、placeholder、Recipe、Manifest/Job、Provider credential 各有唯一真相源；禁止浏览器/localStorage 副本。
- V1 placeholder 与旧 detector/completion/placer 主链在替代链就绪后一次硬切，不保留 compatibility/legacy adapter。
- 单次 Planning Apply 零图片 Job；preview 零数据库/文件副作用；授权事务成功后才注册付费 Job。
- 所有 Project 文件写入使用 tracked write、expected hash、章节锁与明确 journal 阶段；不依靠连续写入冒充事务。
- 代码复杂边界按 TDD：先稳定 RED，再最小 GREEN，再聚焦回归与 typecheck。
- 不自动做浏览器验证；不提交、推送、发布、unstage、amend 或回退前序设计文档。

---

### Task 1: Chapter Storyboard V2 strict contract and codec

**Files:**
- Create: `shared/text-to-image-chapter-storyboard.ts`
- Create: `shared/text-to-image-chapter-storyboard.test.ts`
- Create: `server/text-to-image/chapter-storyboard.codec.ts`
- Create: `server/text-to-image/chapter-storyboard.codec.test.ts`

**Interfaces:**
- Consumes: `ValidatedIllustrationPlan`, `IllustrationPlanningInputBundle`, `SemanticTagResolutionSchema`, strict frontmatter helpers。
- Produces: `ChapterIllustrationStoryboardSchema`, `ChapterIllustrationPlanningSourceSchema`, `ChapterIllustrationShotSchema`, `createChapterIllustrationPlanHash(storyboard)`, `parseChapterStoryboardMarkdown(markdown)`, `renderChapterStoryboardMarkdown(storyboard, body?)`。

- [x] **Step 1: Write strict schema/hash RED tests**

```ts
const parsed = ChapterIllustrationStoryboardSchema.parse(fixture());
expect(createChapterIllustrationPlanHash({...parsed, revisionId: "revision-b"}))
    .toBe(createChapterIllustrationPlanHash(parsed));
expect(() => ChapterIllustrationStoryboardSchema.parse({...fixture(), shots: [shotWithUnknownRun()]})).toThrow();
expect(() => ChapterIllustrationStoryboardSchema.parse({...fixture(), shots: [shotWithRawTagText()]})).toThrow();
```

- [x] **Step 2: Run RED**

Run: `bunx vitest run shared/text-to-image-chapter-storyboard.test.ts server/text-to-image/chapter-storyboard.codec.test.ts`

Expected: FAIL because the schema/codec modules do not exist.

- [x] **Step 3: Implement the contract**

```ts
export const ChapterIllustrationPublicationSchema = z.object({
    journalId: StoryboardStableIdSchema,
    status: z.enum(["pending", "applied"]),
    appliedAt: z.string().datetime().nullable(),
}).strict();

export const ChapterIllustrationStoryboardSchema = z.object({
    schema: z.literal("nbook.chapter-illustrations/v2"),
    chapterPath: ChapterPathSchema,
    revisionId: StoryboardStableIdSchema,
    sourceChapterHash: TextToImageContractHashSchema,
    planHash: TextToImageContractHashSchema,
    planningSources: z.array(ChapterIllustrationPlanningSourceSchema).max(1000),
    shots: z.array(ChapterIllustrationShotSchema).max(1000),
}).strict().superRefine(assertStoryboardOwnershipAndHashes);
```

Canonical `planHash` excludes `revisionId`, publication status/timestamps and Markdown body, but includes chapterPath/sourceChapterHash, normalized planning source facts, active/stale/superseded shot semantics and every `shotIntentHash`.

- [x] **Step 4: Implement strict Markdown round-trip**

Use `parseStrictTextToImageFrontmatter()` and `renderStrictTextToImageFrontmatter()`. Parser must recompute `planHash`; duplicate YAML keys, alias, anchor, explicit tag, unknown fields, unused resolution keys and cross-run shot origin all fail.

- [x] **Step 5: Run GREEN**

Run the Step 2 command. Expected: both files pass.

### Task 2: Prompt Placeholder V2 hard cut

**Files:**
- Modify: `shared/text-to-image-markdown.ts`
- Modify: `shared/text-to-image-markdown.test.ts`
- Modify: `server/text-to-image/chapter.service.ts`
- Modify: `app/components/markdown-studio/tiptap/TextToImagePrompt.ts`
- Test: `server/text-to-image/text-to-image-placeholder-v2-ui-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 `shotId/shotIntentHash/sourceChapterHash/anchorId/origin`。
- Produces: `TextToImagePromptV2PayloadSchema`, `renderTextToImagePromptMarkdown(payload)`, `parseTextToImagePromptMarkdown(markdown)`, `findTextToImagePromptMarkdown(markdown,id)`; no V1 overload.

- [x] **Step 1: Replace V1 tests with V2 rejection/round-trip RED**

```ts
const payload = {
    schema: "nbook.text-to-image-prompt/v2" as const,
    id: "image_prompt_01",
    shotId: "shot_01",
    shotIntentHash: H("1"),
    sourceChapterHash: H("2"),
    anchorId: "p_0001_abcdef12",
    origin: "selection" as const,
};
expect(parseTextToImagePromptMarkdown(renderTextToImagePromptMarkdown(payload))).toEqual(payload);
expect(parseTextToImagePromptMarkdown(v1MarkdownWithPromptText)).toBeNull();
```

- [x] **Step 2: Run RED**

Run: `bunx vitest run shared/text-to-image-markdown.test.ts server/text-to-image/text-to-image-placeholder-v2-ui-contract.test.ts`

Expected: FAIL because current payload stores prompt/negativePrompt/characterIds and the NodeView uses a memory-only state map.

- [x] **Step 3: Hard-cut shared and TipTap attrs**

```ts
export const TextToImagePromptV2PayloadSchema = z.object({
    schema: z.literal("nbook.text-to-image-prompt/v2"),
    shotId: StoryboardStableIdSchema,
    shotIntentHash: TextToImageContractHashSchema,
    sourceChapterHash: TextToImageContractHashSchema,
    anchorId: IllustrationAnchorIdSchema,
    origin: z.enum(["chapter-plan", "selection"]),
}).strict();
```

TipTap attributes mirror only these fields plus outer `id`; delete `prompt`, `negativePrompt`, `characterIds` and the `!prompt` enablement condition. NodeView emits `{placeholderId}` to the host and renders status supplied by the server-facing host, never a CompiledRequest.

- [x] **Step 4: Run GREEN**

Run Step 2 command. Expected: V2 round-trip and static no-V1-payload assertions pass.

### Task 3: Planning Apply Journal persistence contract

**Files:**
- Modify: `prisma/project.schema.prisma`
- Modify: `server/workspace-files/project-workspace.ts`
- Create: `shared/text-to-image-planning-apply.ts`
- Create: `shared/text-to-image-planning-apply.test.ts`
- Create: `server/text-to-image/planning-apply.repository.ts`
- Create: `server/text-to-image/planning-apply.repository.test.ts`

**Interfaces:**
- Consumes: Workflow/Attempt, Task 1 staged/applied storyboard, Task 2 V2 placeholder.
- Produces: `PlanningApplyJournal` states `prepared|storyboard_written|chapter_written|storyboard_applied|completed|rolled_back|apply_conflict`; `prepare`, `advance`, `readRecoverable`, `markWorkflowStale` CAS methods.

- [x] **Step 1: Write journal state-machine and real SQLite RED**

Cover create-only preparation, stage order, idempotent same-hash replay, conflicting payload, and `completed` never creating `TextToImageJob`.

- [x] **Step 2: Run RED**

Run: `bunx vitest run shared/text-to-image-planning-apply.test.ts server/text-to-image/planning-apply.repository.test.ts`

Expected: FAIL with missing schema/model/repository.

- [x] **Step 3: Add Project model and migration initializer**

```prisma
model IllustrationPlanningApplyJournal {
  id                    String   @id
  workflowId            String   @unique
  projectId             String
  chapterPath           String
  state                 String
  expectedChapterHash   String
  expectedStoryboardHash String?
  stagedStoryboardHash  String
  appliedStoryboardHash String
  chapterAfterHash      String
  payloadJson           String
  errorCode             String?
  errorMessage          String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @default(now()) @updatedAt
  @@index([projectId, state, createdAt])
}
```

Use a strict enum if Prisma migration support for the Project schema remains consistent with existing enums; otherwise the shared schema still rejects every unknown state before persistence.

- [x] **Step 4: Generate and test**

Run: `bunx prisma generate --schema prisma/project.schema.prisma`; then Step 2 command. Expected: Prisma generate succeeds and tests pass.

### Task 4: Crash-recoverable Planning Apply service

**Files:**
- Create: `server/text-to-image/planning-apply.service.ts`
- Create: `server/text-to-image/planning-apply.service.test.ts`
- Modify: `server/text-to-image/illustration-workflow.repository.ts`
- Modify: `server/text-to-image/illustration-workflow.scheduler.ts`
- Modify: `server/text-to-image/illustration-workflow.service.ts`

**Interfaces:**
- Consumes: Tasks 1–3, `writeWorkspaceTextFileTracked`, chapter parser and per-file locks.
- Produces: `applyValidatedPlan({projectPath,workflowId})`, `recoverProject(projectPath)`, and workflow `validating -> applying -> ready|stale|failed` transitions.

- [x] **Step 1: Write interruption matrix RED**

Fixtures stop after each stage: prepared, storyboard_written, chapter_written, storyboard_applied. Assert replay reaches the same completed bytes; a chapter hash conflict gives stale with zero fuzzy insertion; selection append preserves old applied shots; chapter replan supersedes only old chapter-plan placeholders after chapter write.

- [x] **Step 2: Run RED**

Run: `bunx vitest run server/text-to-image/planning-apply.service.test.ts`

Expected: FAIL because apply service does not exist.

- [x] **Step 3: Implement staged snapshots and compensation**

`prepared.payloadJson` strict-parses a payload containing storyboard before/staged/applied bytes and hashes, chapter before/after bytes and hashes, new placeholder IDs, superseded placeholder IDs and source workflow hashes. Every write verifies the exact prior hash. A pre-chapter conflict rolls storyboard back only when it still equals staged hash; otherwise journal becomes `apply_conflict` and pending shots stay inert.

- [x] **Step 4: Connect scheduler without holding file locks during Agent work**

After `succeedAttempt`, validation persists the validated plan; scheduler invokes apply only after Agent evidence is sealed. Apply gets the lock just for deterministic file/journal transitions. Cancellation/stale CAS before the first write blocks the batch.

- [x] **Step 5: Run GREEN**

Run Step 2 plus P3 workflow tests. Expected: apply matrix and prior cancel/recovery tests pass.

### Task 5: Typed illustration Compiler and execution hashes

**Files:**
- Create: `shared/text-to-image-execution.ts`
- Create: `shared/text-to-image-execution.test.ts`
- Create: `server/text-to-image/illustration-compiler.ts`
- Create: `server/text-to-image/illustration-compiler.test.ts`
- Delete after Task 10: `server/text-to-image/prompt-compiler.ts`

**Interfaces:**
- Consumes: applied Task 1 shot, effective Pattern snapshots, V2 Character/Outfit registry, RecipeSnapshot, Tag Resolver/Policy, `PROVIDER_GRAMMAR_REGISTRY`, provider snapshot/credentialRevision.
- Produces: `compileIllustration(input): IllustrationCompileResult`, `executionInputHash`, `compiledRequestHash`, `executionManifestHash`; blocking issues never reach adapter.

- [x] **Step 1: Write canonical compile RED**

Cover Pattern groups, shot delta, character/outfit refs, Recipe positive/negative, replacement/passthrough, duplicate removal, positive/negative conflict, mandatory visibility, stable ordering, weights, model scope revalidation and only-referenced Pattern render hashes.

- [x] **Step 2: Run RED**

Run: `bunx vitest run shared/text-to-image-execution.test.ts server/text-to-image/illustration-compiler.test.ts`

Expected: FAIL because typed execution/Compiler modules do not exist.

- [x] **Step 3: Implement strict inputs and pure compilation**

`IllustrationCompiledRequestSchema` owns exact NovelAI wire fields, character prompts/UC, resolved seeds, RecipeSnapshot and expansion snapshot. Generic resolutions are revalidated against `{kind:"novelai-model",modelId:recipe.model}`; provider passthrough keeps wire text except ASCII edge trim. Adapter input is parsed from this schema only and never receives Pattern/Markdown.

- [x] **Step 4: Run GREEN**

Run Step 2 command. Expected: canonical fixtures and all blocking/fingerprint cases pass.

### Task 6: Signed side-effect-free execution preview

**Files:**
- Create: `server/text-to-image/execution-preview-token.ts`
- Create: `server/text-to-image/execution-preview-token.test.ts`
- Create: `server/text-to-image/illustration-execution.service.ts`
- Create: `server/text-to-image/illustration-execution.service.test.ts`
- Create: `server/text-to-image/illustration-execution.compiler.ts`
- Create: `server/api/text-to-image/prompt-placeholders/[placeholderId]/execution-preview.get.ts`
- Create: `server/api/text-to-image/prompt-placeholders/[placeholderId]/execution-preview-batch.post.ts`

**Interfaces:**
- Consumes: Task 5 Compiler and applied placeholder lookup.
- Produces: signed token `{executionNonce,targetHash,manifestHash,expiresAt}`, `previewOne`, `previewBatch`; GET/batch preview writes nothing.

- [x] **Step 1: Write token/seed/no-side-effect RED**

Assert tamper/TTL rejection; same token produces identical random seeds; new preview changes nonce; preview leaves all Project/App table counts and files unchanged; any target blocking issue returns zero preview token.

- [x] **Step 2: Run RED**

Run: `bunx vitest run server/text-to-image/execution-preview-token.test.ts server/text-to-image/illustration-execution.service.test.ts`

Expected: FAIL with missing modules.

- [x] **Step 3: Implement HMAC token and deterministic seeds**

Seed input is exactly `executionNonce + sourceIdentityHash + variantIndex + outputIndex + compilerVersion`, mapped into the provider integer range. Authorization never accepts a client seed.

- [x] **Step 4: Run GREEN**

Run Step 2 command. Expected: token, seed and no-write tests pass.

### Task 7: Atomic Manifest / approval / Job / dispatch outbox registration

**Files:**
- Modify: `prisma/project.schema.prisma`
- Modify: `server/workspace-files/project-workspace.ts`
- Modify: `shared/dto/text-to-image.dto.ts`
- Modify: `shared/text-to-image-execution.ts`
- Create: `server/text-to-image/execution.repository.ts`
- Create: `server/text-to-image/execution.repository.test.ts`
- Modify: `server/text-to-image/illustration-execution.service.ts`
- Create: `server/api/text-to-image/prompt-placeholders/[placeholderId]/generate.post.ts`
- Create: `server/api/text-to-image/prompt-placeholders/[placeholderId]/generate-batch.post.ts`
- Modify: `server/text-to-image/queue.service.ts`

**Interfaces:**
- Consumes: Task 6 token/recompile and current authenticated actor.
- Produces immutable `IllustrationExecutionManifest`, `IllustrationExecutionApproval`, strict-origin `TextToImageJob`, `TextToImageDispatchOutbox`, idempotent receipt.

- [x] **Step 1: Write real SQLite all-or-none RED**

Single and batch fixtures assert one Project transaction writes manifest+approval+all jobs+outbox; injected failure leaves all counts zero. Duplicate dispatch key returns the same receipt. Client prompt/model/style/seed fields are strict-rejected.

- [x] **Step 2: Run RED**

Run: `bunx vitest run server/text-to-image/execution.repository.test.ts server/text-to-image/illustration-execution.service.test.ts`

Expected: FAIL with missing models and authorize path.

- [x] **Step 3: Add immutable models and strict origin fields**

Manifest stores `executionInputHashes`, `executionManifestHash`, RecipeSnapshot and CompiledRequests. Approval stores `approvalHash`, authorized output/cost/token limits, actor and time. Job stores discriminated origin JSON, sourceIdentityHash, provider owner/id/credentialRevision, manifest/approval/compiled hashes, idempotency key and source placeholder identity. Outbox stores stable dispatchKey/jobId/manifestHash and registration version for the next phase’s App preparation.

- [x] **Step 4: Generate and run GREEN**

Run Prisma generate, then Step 2. Expected: all-or-none and duplicate tests pass.

### Task 8: Server-owned placeholder state, preview UI and batch confirmation

**Files:**
- Create: `shared/text-to-image-execution-ui.ts`
- Create: `server/text-to-image/illustration-placeholder.service.ts`
- Create: `server/api/text-to-image/prompt-placeholders/[placeholderId]/status.get.ts`
- Create: `app/utils/illustration-execution-ui.ts`
- Create: `app/composables/useIllustrationExecutionController.ts`
- Modify: `app/components/markdown-studio/tiptap/TextToImagePrompt.ts`
- Modify: `app/components/markdown-studio/tiptap/markdown-editor-extensions.ts`
- Modify: `app/components/markdown-studio/TipTapMarkdownEditor.vue`
- Modify: `app/components/markdown-studio/MarkdownStudio.vue`
- Modify: `app/components/markdown-studio/MarkdownStudioWorkbench.vue`
- Modify: `app/pages/index.vue`
- Modify: `app/components/novel-ide/text-to-image/TextToImageIllustrationWorkflowPanel.vue`
- Modify: `shared/text-to-image-illustration-workflow.ts`
- Modify: `server/text-to-image/illustration-workflow.service.ts`
- Create: `server/text-to-image/illustration-execution-ui-contract.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 6, 7 APIs.
- Produces server status `ready|stale|compiling|queued|running|failed|outcome_unknown`, lazy preview display, one-shot authorize, selected batch preview and one confirmation.

- [x] **Step 1: Write UI contract RED**

Assert NodeView no prompt/local generation Map; host queries placeholder status/preview; authorize body contains only placeholder/token/manifest/limits; batch uses one preview/one authorize action; no Provider/Recipe/NovelAI parameters or localStorage.

- [x] **Step 2: Run RED**

Run: `bunx vitest run server/text-to-image/illustration-execution-ui-contract.test.ts`

- [x] **Step 3: Implement lazy state and explicit error channels**

NodeView emits a typed placeholder reference. Host caches only short-lived preview DTOs, invalidates on server hash/status changes, uses `useNotification()` for queued/failure, and uses a modal confirmation only for batch or refreshed warning/budget manifests.

- [x] **Step 4: Run GREEN**

Run Step 2 command. Expected: static contract passes.

### Task 9: Exact Asset result insertion and lineage fence

**Files:**
- Modify: `server/text-to-image/chapter.service.ts`
- Modify: `server/text-to-image/asset.service.ts`
- Create: `server/text-to-image/illustration-result.service.ts`
- Create: `server/text-to-image/illustration-result.service.test.ts`

**Interfaces:**
- Consumes: terminal Job/Asset from the persistent lane implemented next, Task 2 placeholder and immutable job source hashes.
- Produces `applyAssetResult({projectPath,jobId,assetId,attemptFence}) -> inserted|missing|late`, standard Markdown image and sourceInsertStatus.

- [x] **Step 1: Write exact-match RED**

Cover matching placeholder success, same ID/different shot hash, placeholder removed, superseded replan, duplicate completion, late result and unrelated manual/external image preservation.

- [x] **Step 2: Run RED**

Run: `bunx vitest run server/text-to-image/illustration-result.service.test.ts`

- [x] **Step 3: Implement lock + exact replacement**

Replacement requires outer ID and every immutable V2 payload identity to match Job source snapshot. Missing/mismatch leaves Asset history intact and marks `missing`/late; it never scans by alt text/path prefix and never appends at chapter end.

- [x] **Step 4: Run GREEN**

Run Step 2 command. Expected: all lineage fences pass.

### Task 10: Physical removal of the old body-image chain

**Files:**
- Delete: `server/api/text-to-image/llm-completion.post.ts`
- Delete: `server/api/text-to-image/llm-models.post.ts`
- Delete: old body character/placement API routes and services found by the pre-delete reference audit
- Delete: `server/text-to-image/body-image-character-tags.ts`
- Delete: `server/text-to-image/body-image-prompt-placement.ts`
- Delete: `assets/workspace/.nbook/agent/profiles/builtin/body-image.character-detector.profile.tsx`
- Delete: `assets/workspace/.nbook/agent/profiles/builtin/body-image.prompt-placer.profile.tsx`
- Delete: matching Profile/Skill/tests
- Modify: `app/pages/index.vue`, `app/utils/text-to-image-llm.ts`, Pinia/store and old panel references

**Interfaces:**
- Consumes: Tasks 1–9 replacement route.
- Produces zero runtime reference to detector/completion/placer/V1 prompt/context presets.

- [x] **Step 1: Add negative static RED**

Search runtime/build inputs for old profile keys, endpoints, V1 prompt fields, `bodyImageGenerating` and old completion/context mutations; test must fail before deletion.

- [x] **Step 2: Delete consumers and artifacts in dependency order**

Remove UI calls first, then API/service, then Profile/Skill/tests. Do not add redirect, compatibility parser or hidden feature flag.

- [x] **Step 3: Run affected editor/Profile/API tests**

Expected: new Route B entrypoints pass and old-string negative search is zero outside migration/history documentation.

### Task 11: P4 verification and documentation checkpoint

**Files:**
- Modify: `docs/tasks/text-to-image-panel/README.md`
- Modify: `PROJECT-STATUS.md`
- Modify: `.planning/2026-07-19-route-b-completion/task_plan.md`
- Modify: `.planning/2026-07-19-route-b-completion/progress.md`
- Modify: `.planning/2026-07-19-route-b-completion/findings.md`

- [x] **Step 1: Run focused suites**

Run all Task 1–10 tests plus affected P3 workflow, Recipe, Provider registry, Character V2, overlay and Project migration tests. Expected: all pass.

- [x] **Step 2: Run Prisma/type gates**

Run `bunx prisma generate --schema prisma/project.schema.prisma`, post-generate DB tests, then `bun run typecheck`. Expected: exit code 0.

- [x] **Step 3: Run static ownership audit**

Verify Agent DTO/Profile/Skill/API/placeholder/authorize bodies contain no Provider secret, Recipe mutation, prompt override, NovelAI scalars or localStorage truth. Verify old detector/completion/placer runtime refs are zero.

- [x] **Step 4: Update actual-vs-plan evidence**

Walkthrough records exact files/tests, journal recovery stages, hard-cut deletions and any plan deviations. PROJECT-STATUS changes only when the verified architecture/state is true. Do not run browser validation or any git mutation.

## Self-review

- Spec coverage: §§12–14, 17.3, 18.3, 19.6, 21.5 and the P4 portions of §§22/25 map to Tasks 1–10. Cross-Project persistent lane/credentialRevision/attempt fence intentionally remain the immediately following phase because they require App DB truth and are not safe to hide inside Project Queue.
- Placeholder scan: every task names its concrete contract, failure test, implementation boundary and verification command; no compatibility bridge or unspecified error-handling step remains.
- Type consistency: `shotId/placeholderId` originate in Task 1/4, V2 placeholder in Task 2, compile hashes in Task 5, signed nonce in Task 6, immutable registration in Task 7, and result fence in Task 9. App lane consumes Task 7 outbox without redefining Job/Manifest truth.
- Execution mode: prior user instruction already selected inline continuous execution; no commit step is included because the task explicitly forbids commit/push/release.
