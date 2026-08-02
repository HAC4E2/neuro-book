# Text-to-Image P6 Candidate Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a durable P6 flow in which one explicitly authorized NovelAI request creates 2–8 same-revision candidate assets, the existing `illustration.director` reviews their real image snapshots exactly once, and the user makes one terminal selection or dismisses the set.

**Architecture:** Remove the fake Planning `review-candidates` branch first. Candidate generation is a dedicated execution mode with one immutable CompiledRequest, one paid Job, `n_samples` 2–8, and an ordered multi-asset result that never edits the manuscript. Candidate Review is a separate Project-owned aggregate: it freezes verified asset evidence, snapshots images into the existing Agent attachment store in canonical order, recovers `report_result` through the general Harness seam added by the character plan, and composes terminal selection with P5 promotion in one Project transaction.

**Tech Stack:** TypeScript, Zod, Prisma 7 Project SQLite, Nuxt/H3, Vue 3, Agent Harness, Pi image attachments, NovelAI adapter, Vitest, Bun.

## Global Constraints

- Execute after the P5 plan and before Workflow history hiding.
- Before Task 1, verify P5 promotion/content-hash/compiled-revision seams and the
  character plan's general Harness `onAccepted`/durable-result seams are already
  GREEN. Do not build P6-local substitutes.
- Candidate generation and review must each start from an explicit user action. Never automatically reroll, regenerate, select, promote, or replace manuscript content.
- Candidate Review contains `2..8` unique generated assets from one candidate-batch Job, Manifest, Shot, CompiledRequest hash, and compiled revision.
- Uniqueness means distinct asset IDs/ordinals. Identical returned image bytes
  may share a content hash; do not convert a paid response into failure merely
  because NovelAI produced duplicate-looking bytes.
- One candidate-batch Job makes at most one NovelAI HTTP attempt with
  `n_samples: 2..8`; a successful Job therefore calls exactly once and returns
  exactly that many images. The official schema exposes `n_samples` as an
  integer but does not publish a maximum, so `8` is NeuroBook's conservative
  product limit and must remain a registry/contract value.
- A candidate-batch Job has `sourceInsertStatus = not_applicable` and never calls `IllustrationResultService`.
- Keep the P5 placeholder CompiledRequest v2 (`count === 1`) as an active current
  contract so its successful assets remain valid candidate sources. Add a
  separate CandidateBatchCompiledRequest v1 (`count === 2..8`) and a strict
  executable-request union. P6 bumps execution input/Manifest to v3, Preview to
  v3, registration receipt to v2, Job source identity/idempotency to v2,
  dispatch key to v3, and dispatch registration to v4. Approval v2, Recipe v3,
  and all P5 Provider registry/snapshot versions remain unchanged.
- Current registration accepts only Manifest v3. Retain a separate strict,
  read-only Manifest v2 audit schema solely for completed P5 ownership and
  safe-delete checks; it can never register, dispatch, retry, or authorize work.
- Candidate images enter the Agent only through durable Session attachments. Initial, Project DB, API DTOs, logs, and prompts contain no Base64, raw bytes, absolute paths, credentials, Recipe body, or editable generation parameters.
- Canonical order is ascending `assetId`; persist the resulting ordinal. Agent attachments, output validation, hashes, recovery, API, and UI use that exact order.
- Runtime tool restriction for real `review-candidates` is exactly `["report_result"]`.
- Reuse the character plan's `acquireAgent()`, `onAccepted`, Harness execution
  lease/orphan fence, and
  `readDurableInvocationResult({sessionId,clientMessageId})`; do not create a
  P6-only invocation map or result scraper.
- Reuse P5's Project reference mutation lock and scoped promotion primitives.
  Never nest the lock and never call a model/provider while holding it.
- Project SQLite schema upgrades belong to
  `server/workspace-files/project-workspace.ts`; do not add a
  `prisma/migrations/sqlite` file.
- Do not automate a browser or make a paid NovelAI request.
- Run every `bun`/`bunx` command in this plan outside the sandbox, per repository
  policy.

The exact P6 version literals are:

| Constant | Literal |
|---|---|
| `ILLUSTRATION_CANDIDATE_BATCH_COMPILED_REQUEST_SCHEMA_VERSION` | `nbook.illustration-candidate-batch-compiled-request/v1` |
| `ILLUSTRATION_EXECUTION_INPUT_SCHEMA_VERSION` | `nbook.illustration-execution-input/v3` |
| `ILLUSTRATION_EXECUTION_MANIFEST_SCHEMA_VERSION` | `nbook.illustration-execution-manifest/v3` |
| `ILLUSTRATION_EXECUTION_PREVIEW_VERSION` | `nbook.illustration-execution-preview/v3` |
| `ILLUSTRATION_EXECUTION_REGISTRATION_RECEIPT_VERSION` | `nbook.illustration-execution-registration-receipt/v2` |
| `TEXT_TO_IMAGE_JOB_SOURCE_IDENTITY_VERSION` | `nbook.text-to-image-job-source-identity/v2` |
| `TEXT_TO_IMAGE_JOB_IDEMPOTENCY_VERSION` | `nbook.text-to-image-job-idempotency/v2` |
| `TEXT_TO_IMAGE_DISPATCH_KEY_VERSION` | `nbook.text-to-image-dispatch-key/v3` |
| `ILLUSTRATION_DISPATCH_REGISTRATION_VERSION` | `route-b-dispatch-registration-v4` |

P5's `ILLUSTRATION_COMPILED_REQUEST_SCHEMA_VERSION` remains
`nbook.illustration-compiled-request/v2`; do not overwrite it with the candidate
batch literal.

The following paths are intentional serial prerequisites, not missing P6
creates: the P5 plan creates
`server/text-to-image/illustration-execution-http-error.test.ts`,
`server/text-to-image/reference-promotion.service.ts`, and
`server/text-to-image/reference-promotion.service.test.ts`; the character plan
creates `server/agent/harness/invocation-execution-lease.ts` and its test. This
plan may modify/reuse them only after the delivery index's preceding slices are
GREEN. If any is absent at P6 start, stop and finish the prerequisite plan
instead of inventing a P6-local substitute.

## Frozen Review Contracts

```ts
export type CandidateReviewFrozenCandidate = {
    ordinal: number;
    assetId: string;
    contentHash: string;
    mimeType: "image/png" | "image/jpeg";
    byteLength: number;
};

export const CANDIDATE_REVIEW_CONTRACT_VERSION =
    "nbook.candidate-review/v1";
export const CANDIDATE_SELECTION_REQUEST_VERSION =
    "nbook.candidate-selection-request/v1";

export type CandidateReviewInitial = {
    schemaVersion: "nbook.candidate-review-initial/v1";
    operation: "review-candidates";
    projectId: string;
    manifestId: string;
    shotId: string;
    placeholderId: string;
    compiledRequestHash: string;
    compiledRevision: string;
    candidateSetHash: string;
    candidates: CandidateReviewFrozenCandidate[];
    directorProfileArtifactHash: string;
    directorBindingRevision: string;
};

export type CandidateReviewOutput = {
    schemaVersion: "nbook.candidate-review-output/v1";
    operation: "review-candidates";
    candidateSetHash: string;
    candidates: Array<{
        ordinal: number;
        assetId: string;
        score: number;
        reason: string;
    }>;
    summary: string;
    recommendedAssetId: string | null;
    noQualifiedReason: string | null;
};
```

`score` is a finite integer `0..100`; `reason` is `1..2000` characters;
`summary` is `1..4000`. A recommendation requires `noQualifiedReason === null`.
No recommendation requires a non-empty `noQualifiedReason`.

The exact `candidateSetHash` preimage is:

```text
schemaVersion
projectId
manifestId
shotId
placeholderId
compiledRequestHash
compiledRevision
candidates[] in ordinal order:
  ordinal
  assetId
  contentHash
  mimeType
  byteLength
```

The exact `reviewHash` preimage is:

```text
CANDIDATE_REVIEW_CONTRACT_VERSION
candidateSetHash
directorProfileArtifactHash
directorBindingRevision
validatedCandidates[] in ordinal order:
  ordinal
  assetId
  score
  reason
recommendedAssetId
noQualifiedReason
summary
```

`ILLUSTRATION_DIRECTOR_REVIEW_OPERATION_VERSION` is a separate Profile/runtime
contract input to `directorBindingRevision`; it is not an alias for
`CANDIDATE_REVIEW_CONTRACT_VERSION`.

Public API/client code shares strict safe DTO schemas from
`shared/text-to-image-candidate-review.ts`:

```ts
export type CandidateReviewStatus =
    | "created" | "attaching" | "running" | "completed"
    | "failed" | "outcome_unknown" | "stale" | "selected" | "dismissed";

export type CandidateReviewDto = {
    schemaVersion: "nbook.candidate-review-dto/v1";
    id: string;
    status: CandidateReviewStatus;
    candidateSetHash: string;
    reviewHash: string | null;
    candidates: Array<{
        ordinal: number;
        assetId: string;
    }>;
    result: null | {
        candidates: Array<{ordinal: number; assetId: string; score: number; reason: string}>;
        summary: string;
        recommendedAssetId: string | null;
        noQualifiedReason: string | null;
    };
    activeAttempt: null | {
        ordinal: number;
        status: "created" | "attaching" | "running" | "completed"
            | "failed" | "outcome_unknown";
        stableErrorCode: string | null;
        errorMessage: string | null;
    };
    selection: CandidateSelectionReceiptDto | null;
    stableErrorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
};

export type CandidateReviewPageDto = {
    items: CandidateReviewDto[];
    page: number;
    pageSize: number;
    hasMore: boolean;
};

export type CandidateBatchPageDto = {
    items: Array<{
        schemaVersion: "nbook.candidate-batch-dto/v1";
        jobId: string;
        sourceAssetId: string;
        compiledRevision: string;
        createdAt: string;
        assets: Array<{ordinal: number; assetId: string}>;
    }>;
    page: number;
    pageSize: number;
    hasMore: boolean;
};

export type CandidateSelectionReceiptDto = {
    schemaVersion: "nbook.candidate-selection-receipt/v1";
    selectionId: string;
    reviewId: string;
    reviewHash: string;
    selectedAssetId: string | null;
    promotion: null | {
        promotionId: string;
        referenceAssetId: string;
        referenceContentHash: string;
    };
    actorUserId: number;
    reason: string;
    createdAt: string;
};
```

All schemas are `.strict()`, dates are ISO timestamps, and error messages are
server-sanitized. DTOs return only `assetId`; the client helper combines it with
the host's already-held `projectPath` to call the existing same-origin asset
content route. DTOs never embed a Project path or URL and never contain Agent
Session IDs, attachment IDs, internal Job or Manifest JSON, Profile pins, raw
bytes, or Provider credentials.

---

### Task 1: Delete the fake Planning review branch

**Files:**

- Modify: `shared/text-to-image-illustration-planning.ts`
- Modify: `shared/text-to-image-illustration-planning.test.ts`
- Modify: `shared/text-to-image-illustration-workflow.ts`
- Modify: `shared/text-to-image-illustration-workflow.test.ts`
- Modify: `server/text-to-image/illustration-planning-input.builder.ts`
- Modify: `server/text-to-image/illustration-planning-input.builder.test.ts`
- Modify: `server/text-to-image/illustration-plan-validator.ts`
- Modify: `server/text-to-image/illustration-plan-validator.test.ts`
- Modify: `server/text-to-image/illustration-workflow.scheduler.ts`
- Modify: `server/text-to-image/illustration-workflow.scheduler.test.ts`
- Modify: `server/text-to-image/illustration-workflow.repository.ts`
- Modify: `server/text-to-image/illustration-workflow.repository.test.ts`
- Modify: `server/text-to-image/illustration-planning-test-fixture.ts`
- Modify: `prisma/project.schema.prisma`
- Modify (generated): `server/generated/project-prisma/**`
- Modify: `server/workspace-files/project-workspace.ts`
- Modify: `server/workspace-files/project-workspace.test.ts`
- Create: `server/text-to-image/candidate-review-old-chain-removal.test.ts`
- Delete: `server/agent/tools/illustration-review-tools.ts`
- Modify: `server/agent/tools/index.ts`

- [ ] **Step 1: Add a failing removal/ownership test**

Create or extend a static test to require:

- Planning operation schemas contain only `plan-chapter` and `plan-selection`;
- Planning start requests reject `review-candidates`;
- no review stub bundle, validator shortcut, `skipApplyToReady`, repository
  mapping, Project enum value, fixture, scheduler prompt, or registered
  `list_chapter_illustrations`/`get_illustration_detail` tool remains;
- `shared/agent/illustration-director.ts` may still reserve the real P6 operation.
- old Project rows whose operation is `review_candidates` are deleted with their
  fake Planning attempts/journals by the idempotent Project upgrader; they are
  not retained as unreadable Prisma-enum rows or converted into real reviews.

Run:

```powershell
bunx vitest run shared/text-to-image-illustration-planning.test.ts shared/text-to-image-illustration-workflow.test.ts server/text-to-image/illustration-planning-input.builder.test.ts server/text-to-image/illustration-plan-validator.test.ts server/text-to-image/illustration-workflow.scheduler.test.ts server/text-to-image/illustration-workflow.repository.test.ts server/agent/profiles/illustration-director-assets.test.ts server/text-to-image/candidate-review-old-chain-removal.test.ts --maxWorkers=1
```

Expected: FAIL on the current fake branch and registered read tools.

- [ ] **Step 2: Remove every fake owner**

Delete the union branches and shortcut logic rather than mapping them to the new
domain. Remove `review_candidates` from the Prisma enum and new-database schema;
in the real Project upgrader, delete fake `review_candidates` workflow rows and
their cascade-owned attempts/journals before the generated client reads the
removed enum. They are scaffolding, not audit facts, and are never converted
into real reviews. Do not modify plan/apply behavior for the two real Planning
operations.

Implement that hard cut as idempotent raw-SQL
`removeFakeCandidateReviewPlanningRows()` inside
`initProjectDatabaseAtRoot()`, before any generated Project client query. Task 4
later creates the independent review tables; this cleanup helper does not depend
on them.

- [ ] **Step 3: Run the focused Planning suite and source scan**

Regenerate the Project client, run the Step 1 command, and verify the real
old-Project cleanup:

```powershell
bun run generate
bunx vitest run server/workspace-files/project-workspace.test.ts --maxWorkers=1
```

Then run:

```powershell
$hits = rg -n --glob '!**/*.test.ts' "review-candidates|review_candidates|skipApplyToReady|list_chapter_illustrations|get_illustration_detail" shared/text-to-image-illustration-planning.ts shared/text-to-image-illustration-workflow.ts server/text-to-image/illustration-planning-input.builder.ts server/text-to-image/illustration-plan-validator.ts server/text-to-image/illustration-workflow.scheduler.ts server/text-to-image/illustration-workflow.repository.ts server/agent/tools prisma/project.schema.prisma; if ($LASTEXITCODE -eq 0) { $hits; throw "fake Planning/tool owner remains" }; if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
```

Expected: tests PASS; scan has no fake Planning/tool hits.

- [ ] **Step 4: Commit the removal slice**

Suggested commit:

```text
refactor(text-to-image): remove fake planning candidate review
```

---

### Task 2: Add one paid multi-output candidate generation mode

**Files:**

- Modify: `shared/text-to-image-execution.ts`
- Modify: `shared/text-to-image-execution.test.ts`
- Modify: `server/text-to-image/execution.test-fixtures.ts`
- Modify: `shared/text-to-image-provider-registry.ts`
- Modify: `shared/text-to-image-provider-registry.test.ts`
- Modify: `shared/text-to-image-execution-ui.ts`
- Modify: `shared/dto/text-to-image.dto.ts`
- Modify: `server/text-to-image/illustration-execution.service.ts`
- Modify: `server/text-to-image/illustration-execution.service.test.ts`
- Modify: `server/text-to-image/illustration-execution-http-error.ts`
- Modify: `server/text-to-image/illustration-execution-http-error.test.ts`
- Modify: `server/text-to-image/execution.repository.ts`
- Modify: `server/text-to-image/execution.repository.test.ts`
- Modify: `server/text-to-image/illustration-registration.coordinator.ts`
- Modify: `server/text-to-image/illustration-registration.coordinator.test.ts`
- Modify: `server/text-to-image/registration-projection.test.ts`
- Modify: `server/text-to-image/dispatch-preparation.repository.ts`
- Modify: `server/text-to-image/dispatch-preparation.repository.test.ts`
- Modify: `server/text-to-image/dispatch-reconciler.ts`
- Modify: `server/text-to-image/dispatch-reconciler.test.ts`
- Modify: `server/text-to-image/novelai-image-generation.ts`
- Modify: `server/text-to-image/novelai-image-generation.test.ts`
- Modify: `server/text-to-image/project-illustration-dispatch.ts`
- Modify: `server/text-to-image/project-illustration-dispatch.test.ts`
- Modify: `server/text-to-image/project-dispatch.repository.ts`
- Modify: `server/text-to-image/project-dispatch.repository.test.ts`
- Modify: `server/text-to-image/illustration-dispatch.worker.ts`
- Modify: `server/text-to-image/illustration-dispatch.worker.test.ts`
- Modify: `server/text-to-image/queue.service.ts`
- Modify: `server/text-to-image/queue.service.test.ts`
- Modify: `server/text-to-image/asset.service.ts`
- Modify: `server/text-to-image/asset.service.test.ts`
- Modify: `server/text-to-image/illustration-placeholder.service.ts`
- Modify: `server/text-to-image/illustration-placeholder.service.test.ts`
- Modify: `prisma/project.schema.prisma`
- Modify (generated): `server/generated/project-prisma/**`
- Modify: `server/workspace-files/project-workspace.ts`
- Modify: `server/workspace-files/project-workspace.test.ts`
- Create: `server/api/text-to-image/assets/[id]/candidate-generation-preview.post.ts`
- Create: `server/api/text-to-image/assets/[id]/candidate-generation.post.ts`
- Create: `server/api/text-to-image/assets/candidate-generation-api-contract.test.ts`
- Modify: `app/utils/illustration-execution-ui.ts`
- Modify: `app/composables/useIllustrationExecutionController.ts`
- Modify: `app/components/novel-ide/text-to-image/TextToImageAssetDetailDialog.vue`
- Modify: `app/components/novel-ide/text-to-image/TextToImageIllustrationWorkflowPanel.vue`
- Modify: `server/text-to-image/illustration-execution-ui-contract.test.ts`

**Execution modes:**

```ts
type IllustrationExecutionMode =
    | {kind: "placeholder"; outputCount: number}
    | {kind: "candidate-batch"; sourceAssetId: string; outputCount: 2 | 3 | 4 | 5 | 6 | 7 | 8};

type IllustrationExecutableRequest =
    | IllustrationCompiledRequest // P5 v2, count === 1
    | IllustrationCandidateBatchCompiledRequest; // candidate-batch v1, count === 2..8
```

Freeze the new persisted literals once and export them from the shared
execution contract:

```ts
export const TEXT_TO_IMAGE_CANDIDATE_JOB_KIND = "illustration_candidate_batch";
export const TEXT_TO_IMAGE_CANDIDATE_ASSET_SOURCE_KIND = "illustration_candidate_batch";
```

The Prisma enum must declare the exact
`illustration_candidate_batch` literal because Prisma cannot import TypeScript.
A contract test reads/uses the generated enum and proves it equals
`TEXT_TO_IMAGE_CANDIDATE_JOB_KIND`. Job DTOs, TypeScript dispatch filters,
generated asset writes, History/detail guards, and all remaining runtime code
consume the exported constants instead of duplicating strings.

- [ ] **Step 1: Write failing multi-output tests**

Prove:

- a candidate preview starts from an existing successful generated asset and its
  immutable Job request, never from client Prompt/Recipe fields;
- source asset/job/request/provider ownership and stored content hash are
  reverified;
- current provider ID and credential revision must still match the frozen request;
- manual/old generated assets without a strict P5 `compiledRevision` are
  ineligible;
- output count `2` and `8` succeed; `1` and `9` fail;
- preview signs mode, source asset, count, one CompiledRequest, exact total
  `additionalCostLowerBound`, and total token lower bound;
- authorization accepts those totals only as
  `acceptedAdditionalCostLowerBound`/`acceptedTokenLowerBound` evidence and
  requires exact equality;
- authorization registers one Manifest, Approval, candidate Job, and outbox;
- the candidate Job has one CompiledRequest with `parameters.count === outputCount`;
- existing placeholder/batch registration still requires one-output requests;
- NovelAI wire sets `n_samples` to the frozen count and rejects a ZIP with any
  other image count;
- every returned candidate must fully decode as PNG or JPEG; WebP/other output
  makes the whole paid attempt a stable non-retryable provider-response failure
  before any asset row is committed, preserving P5 promotion compatibility;
- all returned images are saved with stable `outputIndex` and the same
  Manifest/Job/CompiledRequest/revision;
- duplicate image bytes still produce distinct ordered asset IDs/rows, while
  duplicate asset IDs or ordinals are rejected;
- candidate completion writes ordered `resultAssetIdsJson`, sets
  `sourceInsertStatus=not_applicable`, and never calls manuscript replacement;
- placeholder status ignores candidate Jobs.
- Project dispatch recovery distinguishes one Job from N outputs and never
  requires `jobIds.length === outputCount`;
- Job/list DTO parsing recognizes the candidate kind, but the old manual queue's
  enqueue/run/recover/cancel/retry paths all reject or exclude it. Candidate
  generation is owned only by the signed Project dispatch path; another paid
  attempt requires a fresh preview and authorization;
- after the durable lane/Job `attempt_started` fence, candidate dispatch never
  enters `retry_wait`: definite `429`/`5xx` responses become stable
  non-retryable failed, network/timeout ambiguity becomes `outcome_unknown`, and
  repeated worker ticks/restart keep NovelAI call count at one;
- a proven local batch-persistence failure becomes stable non-retryable
  `failed`, while a crash/unknown send outcome remains `outcome_unknown`;
- every changed P6 version literal is bumped as frozen above; placeholder v2 is
  still accepted only by the placeholder branch, while candidate-batch v1 is
  rejected there and required by the candidate branch.
- current Manifest registration rejects v2, while the read-only historical
  audit parser accepts a valid self-hashed P5 Manifest v2 and rejects tampering;

Run:

```powershell
bunx vitest run shared/text-to-image-provider-registry.test.ts shared/text-to-image-execution.test.ts server/text-to-image/illustration-execution.service.test.ts server/text-to-image/illustration-execution-http-error.test.ts server/text-to-image/execution.repository.test.ts server/text-to-image/illustration-registration.coordinator.test.ts server/text-to-image/registration-projection.test.ts server/text-to-image/dispatch-preparation.repository.test.ts server/text-to-image/dispatch-reconciler.test.ts server/text-to-image/novelai-image-generation.test.ts server/text-to-image/project-illustration-dispatch.test.ts server/text-to-image/project-dispatch.repository.test.ts server/text-to-image/illustration-dispatch.worker.test.ts server/text-to-image/queue.service.test.ts server/text-to-image/asset.service.test.ts server/text-to-image/illustration-placeholder.service.test.ts server/text-to-image/illustration-execution-ui-contract.test.ts server/api/text-to-image/assets/candidate-generation-api-contract.test.ts --maxWorkers=1
```

Expected: FAIL because `count` is fixed at one and result handling accepts one
image.

- [ ] **Step 2: Discriminate registration and authorization**

Add `executionMode` to Preview, signed target hash, Manifest hash input, immutable
Manifest record, registration input, and Job origin. Rules:

- `placeholder`: existing request/job cardinality remains unchanged;
- `candidate-batch`: exactly one request/job/outbox, output count `2..8`, request
  count equals authorized output count, and source asset identity is frozen;
- receipt reports both `outputCount` and one `jobId` without assuming the arrays
  have equal lengths.

Compute total lower bounds as the per-image P5 lower bound multiplied by count.
Do not label either value as an exact fee.

Export the conservative product maximum `8` once from the Provider registry
module and consume it in CandidateBatchCompiledRequest/UI schemas, but do not
change the persisted P5 capability snapshot shape/hash merely to store this
NeuroBook policy. It is not presented as a documented NovelAI server maximum.
Make `project-dispatch.repository.ts` validate job cardinality from the mode
(`N` placeholder jobs versus one candidate Job) and output cardinality
separately. The App preparation/reconciler persists and dispatches one candidate
Job; it never infers output cardinality from `jobIds`. The Project inspector
strictly verifies mode/count against the Manifest before constructing receipt
v2, while the existing App preparation snapshot continues to bind
Manifest/job/dispatch closure and therefore needs no new App SQLite column or
shared dispatch-snapshot version.
Keep the old queue read DTO exhaustive, but exclude the candidate literal from
its enqueue worker, startup recovery, cancel, and retry queries and reject direct
calls with `TEXT_TO_IMAGE_CANDIDATE_REAUTHORIZATION_REQUIRED`.

The persistent Provider lane may retry lease/claim work only before
`attempt_started`. Once a candidate Job crosses that fence,
`ProjectIllustrationDispatch` returns no retryable result for any HTTP status:
`429`/`5xx`/other definite Provider rejection seals `failed`, while transport
ambiguity seals `outcome_unknown`. The production
`IllustrationDispatchWorker` instantiated by
`server/plugins/text-to-image-provider-lane.ts` must never translate either
result to `retry_wait`. Even a stale/corrupt candidate lane item already in a
retry state is stopped by the Project Job `attempt_started` fence before a
second send. A fake-adapter integration test runs that production worker
composition, advances retry clocks, reconstructs it, and proves the outbound
call count remains exactly one.

Bump the named schema/hash/registration constants listed in Global Constraints;
extract named constants for CandidateBatchCompiledRequest, registration receipt,
Job source identity, idempotency, and dispatch key instead of leaving inline
version strings. The P6 Project upgrader terminalizes incompatible pending v3
registrations before v4 is accepted, but retains completed placeholder v2
Jobs/assets as valid immutable candidate sources. One version literal never
describes both request cardinalities.

- [ ] **Step 3: Compile the candidate request from immutable lineage**

Add service methods:

```ts
previewCandidates({projectPath, ownerUserId, sourceAssetId, outputCount})
authorizeCandidates({projectPath, ownerUserId, sourceAssetId, previewToken, manifestHash, authorization})
```

Read the source asset's Job `requestJson`, strict-parse it, verify its persisted
P5 integrity evidence, require a current matching Provider revision, assign a new
execution nonce/seed, set count, recompute the self-hash, and preserve the
semantic `compiledRevision`. Never reread or mutate current Recipe/Storyboard.
The source parser accepts only a successful Route-B placeholder
`IllustrationCompiledRequest` v2 with `count === 1`; it rejects manual assets,
CandidateBatchCompiledRequest, historical schema versions, and any source whose
Job terminal fence/result IDs do not exactly own the asset.

The two new routes are strict:

| Route | Input owned by client | Result |
|---|---|---|
| `POST /api/text-to-image/assets/:id/candidate-generation-preview` | body `{projectPath, outputCount}` | `200`, signed Candidate Preview v3 |
| `POST /api/text-to-image/assets/:id/candidate-generation` | body `{projectPath, previewToken, manifestHash, authorization}` | `202`, registration receipt v2 |

The asset ID comes only from the route. Both handlers require the current user,
assert that `projectPath` is the open Project, strict-reject extra fields, and
delegate all domain mapping to `illustration-execution-http-error.ts`. Freeze
stable mappings for invalid count/body (`400`), missing source (`404`), and
ineligible/stale/tampered/old-contract source, expired preview, authorization
mismatch, or Provider revision drift (`409`). Route tests assert status, safe
body shape, and zero Project writes on every rejection.

- [ ] **Step 4: Save a candidate response as one ordered terminal unit**

Change the compiled adapter response to `images[]`. For a candidate Job:

1. verify exact image count;
2. `TextToImageAssetService.prepareBatch()` fully validates every output as PNG
   or JPEG and publishes every
   output into deterministic, request-unique generated-asset paths without a DB
   write;
3. open one Project transaction and call
   `commitPreparedBatch({transaction,prepared})` for all asset rows with
   `outputIndex=0..N-1`;
4. in that same transaction CAS the Job fence to `succeeded` with the ordered
   IDs;
5. on a known transaction failure, remove only this request's exact prepared
   files and seal a non-retryable local persistence failure;
6. on a process/network ambiguity before the terminal transaction is known,
   return `outcome_unknown` and never make another paid request.

Do not loop over the existing single-image `save()` and call that atomic.
`commitPreparedBatch()` owns no transaction and accepts only a caller transaction.
Two different output slots remain two asset rows even when their bytes/hash
match. Recovery/eligibility ignores any orphan file or asset row unless the Job
terminal fence and full ordered `resultAssetIdsJson` agree.

Use a typed local persistence error so `ProjectIllustrationDispatch.execute()`
maps this proven post-response failure to `failed`; do not let the generic
unknown-error branch mislabel it as remote ambiguity or retry it.
No candidate asset is review-eligible until all rows and terminal Job evidence
exist.

- [ ] **Step 5: Add Project schema upgrades**

Add candidate Job kind, Manifest execution mode/source asset, and generated asset
`outputIndex` fields to `prisma/project.schema.prisma`,
`PROJECT_MIGRATION_SQL`, and an idempotent
`ensureTextToImageCandidateGenerationSchema()` called by
`initProjectDatabaseAtRoot()`. Test both a new Project and an old minimal Project.

The helper also hard-cuts the P5 dispatch-registration-v3 closure before v4 is
accepted, inside one raw SQLite `BEGIN IMMEDIATE` transaction:

- remove incompatible pending v3 outboxes;
- mark their `queued` Jobs failed with
  `TEXT_TO_IMAGE_CONTRACT_UPGRADED`;
- mark `running|completing` Jobs `outcome_unknown`, because a paid send may
  already have happened;
- retain terminal P5 placeholder Jobs, assets, their CompiledRequest v2
  `requestJson`, and immutable Manifest v2 audit evidence: Jobs/assets remain
  candidate sources, while Manifest reference evidence remains a safe-delete
  owner;
- never reinterpret a v3 receipt/outbox as v4.

Inject a mid-upgrade failure and prove rollback restores the whole old closure;
then retry and prove the helper converges exactly once. The Preview/registration
schema tests must also reject every old P6-changed version literal while still
accepting the active P5 placeholder CompiledRequest v2 branch. The dedicated
Manifest audit parser verifies original v2 hash/shape for ownership only; all
current execution/registration APIs reject it.

Run:

```powershell
bun run generate
bunx vitest run server/workspace-files/project-workspace.test.ts --maxWorkers=1
```

Expected: generated client and real Project initializer agree.

- [ ] **Step 6: Run the multi-output suite**

Run the Step 1 command again plus the API contract test.

Expected: PASS without a paid request.

- [ ] **Step 7: Commit the generation slice**

Suggested commit:

```text
feat(text-to-image): generate same revision candidate batches
```

---

### Task 3: Define strict Candidate Review and hash contracts

**Files:**

- Create: `shared/text-to-image-candidate-review.ts`
- Create: `shared/text-to-image-candidate-review.test.ts`
- Modify: `shared/agent/illustration-director.ts`
- Modify: `server/agent/profiles/catalog.ts`
- Modify: `server/agent/profiles/catalog.test.ts`
- Modify: `server/agent/harness/types.ts`
- Modify: `server/agent/harness/neuro-agent-harness.ts`
- Modify: `server/agent/harness/neuro-agent-harness.test.ts`

- [ ] **Step 1: Write failing schema/hash tests**

Test:

- 2–8 candidates, unique asset IDs, exact contiguous ordinal; duplicate content
  hashes are allowed for different paid output slots;
- canonical input order is ignored because the freezer sorts by `assetId`;
- every candidate evidence field affects `candidateSetHash`;
- timestamps, submission order, paths, session/invocation IDs, and UI state cannot
  enter the hash;
- output rejects missing, duplicate, extra, reordered, or closure-external items;
- score rejects NaN, Infinity, fractions, and out-of-range values;
- recommendation/null reason mutual exclusion;
- every reviewed field, both Director identities, and
  `CANDIDATE_REVIEW_CONTRACT_VERSION` affect `reviewHash`;
- session/time fields do not affect `reviewHash`;
- a file-backed Profile pin contains the actual compiled artifact hash and
  effective binding revision;
- a source artifact or effective model/provider setting change between pin and
  create/invocation fails before admission/Provider start;
- process restart with unchanged Profile artifacts/settings reconstructs the
  exact same pin;
- in-memory test Profiles receive a deterministic manifest/schema identity.

Run:

```powershell
bunx vitest run shared/text-to-image-candidate-review.test.ts server/agent/profiles/catalog.test.ts server/agent/harness/neuro-agent-harness.test.ts --maxWorkers=1
```

Expected: FAIL because the contract and profile execution identity API do not
exist.

- [ ] **Step 2: Implement canonical schemas and hash functions**

Expose:

```ts
freezeCandidateSet(input): CandidateReviewInitial;
validateCandidateReviewOutput(initial, raw): ValidatedCandidateReview;
createCandidateSetHash(input): string;
createCandidateReviewHash(input): string;
```

All helpers strict-parse at entry and return new immutable arrays. The validator
must compare both ordinal and asset ID, not only set membership.
`createCandidateReviewHash()` uses
`CANDIDATE_REVIEW_CONTRACT_VERSION`; it never substitutes the Director operation
version.

Add the dedicated
`ILLUSTRATION_DIRECTOR_REVIEW_OPERATION_VERSION` constant beside the existing
Director converter/plan operation versions. It participates in the binding
revision and changes whenever the review Initial/output/tool/prompt contract
changes.

- [ ] **Step 3: Add an atomic Harness Profile pin/verify seam**

Extend Catalog runtime resolution with the compiled artifact SHA-256 for
file-backed Profiles and a deterministic manifest/schema hash for in-memory test
Profiles, but keep Catalog private behind the Harness.

Expose a general Harness seam:

```ts
export type AgentProfileExecutionPin = {
    profileKey: string;
    profileArtifactHash: string;
    bindingRevision: string;
};

pinProfileExecution(input: {
    profileKey: string;
    projectPath: string;
    operationVersion: string;
}): Promise<AgentProfileExecutionPin>;
```

`CreateAgentInput` and `InvokeAgentInput` accept the expected pin plus the same
explicit `operationVersion`. The Harness re-resolves the Profile and recomputes
the binding revision from that operation version while creating the Session and
again in invocation admission, before any Provider start. Recovery supplies the
current `ILLUSTRATION_DIRECTOR_REVIEW_OPERATION_VERSION`; if an upgrade changed
it, the persisted binding revision no longer matches and the old unaccepted
attempt fails closed rather than silently running a new contract. Candidate
Review never reads Catalog and never performs a separate “read hash, then hope
createAgent uses it” sequence.

Do not persist or compare Catalog's process-local `catalogGeneration`; it is
only an in-memory cache invalidation counter and cannot survive restart. The
three pin fields above are stable across process reconstruction. If Catalog
needs an additional identity later, it must be a deterministic digest of stable
catalog inputs, not a runtime counter.

Compute `bindingRevision` from effective configured model/provider identity,
Profile model settings, and
`ILLUSTRATION_DIRECTOR_REVIEW_OPERATION_VERSION`. Do not freeze credentials or
display-only model labels. The pin actually accepted by the Harness is the
identity persisted in Candidate Review and used by `reviewHash`.

- [ ] **Step 4: Run the contract tests**

Run the Step 1 command again.

Expected: PASS.

- [ ] **Step 5: Commit the contract slice**

Suggested commit:

```text
feat(text-to-image): define strict candidate review contracts
```

---

### Task 4: Persist the independent Candidate Review aggregate

**Files:**

- Modify: `prisma/project.schema.prisma`
- Modify (generated): `server/generated/project-prisma/**`
- Modify: `server/workspace-files/project-workspace.ts`
- Modify: `server/workspace-files/project-workspace.test.ts`
- Create: `server/text-to-image/candidate-review.repository.ts`
- Create: `server/text-to-image/candidate-review.repository.test.ts`
- Modify: `server/text-to-image/asset.service.ts`
- Modify: `server/text-to-image/asset.service.test.ts`
- Modify: `server/text-to-image/reference-asset.service.ts`
- Modify: `server/text-to-image/reference-asset.service.test.ts`

**Project records:**

```prisma
model TextToImageCandidateReview {
  id                               String   @id
  projectId                        String
  manifestId                       String
  jobId                            String
  shotId                           String
  placeholderId                    String
  compiledRequestHash              String
  compiledRevision                 String
  candidateSetHash                 String   @unique
  status                           String
  activeAttemptId                  String?
  nextAttemptOrdinal               Int      @default(0)
  completedProfileArtifactHash     String?
  completedBindingRevision         String?
  reviewHash                       String?  @unique
  resultJson                       String?
  stableErrorCode                  String?
  errorMessage                     String?
  createdAt                        DateTime @default(now())
  updatedAt                        DateTime @updatedAt
}

model TextToImageCandidateReviewAsset {
  reviewId      String
  ordinal       Int
  assetId       String
  contentHash   String
  mimeType      String
  byteLength    Int
  asset         TextToImageAsset @relation("CandidateReviewAssets", fields: [assetId], references: [id], onDelete: Restrict)

  @@id([reviewId, ordinal])
  @@unique([reviewId, assetId])
}

model TextToImageCandidateReviewAttempt {
  id                          String   @id
  reviewId                    String
  ordinal                     Int
  status                      String
  directorProfileArtifactHash String
  directorBindingRevision     String
  sessionAcquisitionTag       String   @unique
  agentSessionId              Int?
  clientMessageId             String
  invocationId                String?
  claimId                     String?
  claimFence                  Int      @default(0)
  claimExpiresAt              DateTime?
  acceptedClaimFence          Int?
  stableErrorCode             String?
  errorMessage                String?
  createdAt                   DateTime @default(now())
  acceptedAt                  DateTime?
  finishedAt                  DateTime?

  @@unique([reviewId, ordinal])
  @@unique([agentSessionId, clientMessageId])
  @@index([status, claimExpiresAt])
}

model TextToImageCandidateReviewAttachment {
  attemptId    String
  ordinal      Int
  attachmentId String

  @@id([attemptId, ordinal])
  @@unique([attemptId, attachmentId])
}

model TextToImageCandidateSelection {
  id               String   @id
  reviewId         String   @unique
  expectedReviewHash String
  selectedAssetId  String?
  reason           String
  requestHash      String   @unique
  actorUserId      Int
  promotionId      String?
  createdAt        DateTime @default(now())
  selectedAsset    TextToImageAsset? @relation("CandidateSelections", fields: [selectedAssetId], references: [id], onDelete: Restrict)
  promotion       TextToImageReferencePromotion? @relation(fields: [promotionId], references: [id], onDelete: Restrict)
}
```

Add the matching named inverse relations to `TextToImageAsset` and
`TextToImageReferencePromotion`. These DB restrictions are the final race
fences behind the service's stable ownership errors.

- [ ] **Step 1: Write failing repository/state tests**

Use real temporary Project SQLite and cover:

- freeze only `2..8` submitted assets that are unique members of one terminal
  candidate-batch Job's fully verified `resultAssetIdsJson` closure; the review
  may use a subset and must not require every paid output;
- candidate evidence accepts only the shared P5 promotable PNG/JPEG MIME schema;
  WebP cannot enter a Review that promises every candidate is selectable;
- missing/tampered file or metadata enters `stale`;
- mixed Manifest/Job/Shot/hash/revision, duplicates, and counts outside 2–8 fail;
- same `candidateSetHash` create/restart returns one aggregate;
- every explicit retry appends one immutable attempt row and its own attachment
  rows; it never overwrites a previous Session/invocation/attachment identity;
- legal CAS transitions:
  `created -> attaching -> running -> completed -> selected|dismissed`;
- `created|attaching|running -> stale|failed`;
- `attaching -> outcome_unknown` is allowed only when the Harness Session
  `execution_lease_established` marker exists but sidecar evidence is lost
  (`providerStartRecorded: null`) before Project `onAccepted` writeback;
- `running -> outcome_unknown` is allowed when the durable Provider-start marker
  is true or established execution evidence is lost (`null`);
- both `outcome_unknown` transitions are terminal and cannot retry, resume,
  select, or transition back to running;
- `completed -> stale` is allowed only before selection/dismissal when the
  mandatory full candidate revalidation fails;
- `failed -> stale` occurs when explicit retry revalidation finds damaged
  candidates; otherwise `failed -> attaching` exists only through explicit
  retry and appends a new attempt row;
- `retry()` rejects `outcome_unknown`; only a provider-not-started orphan may
  become ordinary `failed` and use the explicit retry transition;
- completed result, winning attempt identity, and hashes are immutable;
- stale cannot be restarted or selected;
- generated asset deletion is rejected while frozen by any review;
- reference safe-delete remains protected by P5 promotion
  `referenceContentHash`; selection retains audit lineage through
  `promotionId` and is not a second byte owner.

Run:

```powershell
bunx vitest run server/text-to-image/candidate-review.repository.test.ts server/text-to-image/asset.service.test.ts server/text-to-image/reference-asset.service.test.ts server/workspace-files/project-workspace.test.ts --maxWorkers=1
```

Expected: FAIL because the aggregate and owner checks do not exist.

- [ ] **Step 2: Add idempotent new/old Project schema support**

Add all five tables, unique indexes, and restrictive ownership relations to the
Prisma schema, `PROJECT_MIGRATION_SQL`, and
`ensureTextToImageCandidateReviewSchema()`. P6 schema helper runs after the P5
reference helper and candidate-generation helper.

Run:

```powershell
bun run generate
```

- [ ] **Step 3: Implement repository freeze and CAS**

The repository receives an already verified/canonical set, persists it in one
transaction, and returns strict DTOs. It must never parse Agent output, load
bytes, call the Harness, or promote references.

The service first verifies the source Job's complete ordered result closure and
each submitted asset's membership/output index, then sorts the chosen subset by
`assetId` and assigns fresh contiguous review ordinals. Review ordinals are not
the Provider `outputIndex`; no caller may smuggle an asset from another Job or
claim a forged ordinal.

It also owns the attempt lease protocol. A claim transaction assigns a random
`claimId`, advances `claimFence`, and sets a short `claimExpiresAt`; takeover is
allowed only after expiry. Every attachment/admission/finalization mutation
compares attempt ID + claim ID + fence. Lease renewal is a fenced CAS. Claim
fields are operational metadata and never enter Initial, `candidateSetHash`, or
`reviewHash`.

The service/scheduler, not the repository, fully reverifies candidate
records/files through the P5 asset service when freezing, before attachment,
before recovered-result finalization, and before selection. Paginated list/read
may use frozen metadata plus `stat`-level missing/size evidence; do not hash and
decode up to eight images on every UI poll. Any full-verification failure
persists a stable stale code rather than guessing or regenerating.
For a completed, not-yet-selected review this is the sole
`completed -> stale` path; validated result/hash fields remain immutable even
though the status changes.

- [ ] **Step 4: Extend deletion ownership**

Reject generated-asset deletion when any frozen candidate row references it.
Selection is additional generated-asset audit ownership through its selected
candidate/review relation, while the P5 promotion relation remains another
restrictive owner. Do not treat an unpromoted Candidate Review as a
reference-asset owner merely because content hashes match. P5 reference deletion
continues to reject the actual promotion row; its linked selections remain
auditable through `promotionId`. Map DB restrictions to stable domain errors
rather than leaking Prisma messages.

- [ ] **Step 5: Run repository and schema tests**

Run the Step 1 command again.

Expected: PASS.

- [ ] **Step 6: Commit the persistence slice**

Suggested commit:

```text
feat(text-to-image): persist candidate review state
```

---

### Task 5: Add the real Director review operation and durable orchestration

**Files:**

- Modify: `assets/workspace/.nbook/agent/profiles/builtin/illustration.director.profile.tsx`
- Modify: `shared/agent/illustration-director.ts`
- Modify: `server/agent/profiles/illustration-director-assets.test.ts`
- Create: `server/text-to-image/candidate-review.scheduler.ts`
- Create: `server/text-to-image/candidate-review.scheduler.test.ts`
- Create: `server/text-to-image/candidate-review.service.ts`
- Create: `server/text-to-image/candidate-review.service.test.ts`
- Create: `server/text-to-image/candidate-review.integration.test.ts`
- Modify: `server/text-to-image/candidate-review.repository.ts`
- Modify: `server/text-to-image/candidate-review.repository.test.ts`
- Reuse: `server/agent/harness/types.ts`
- Reuse: `server/agent/harness/neuro-agent-harness.ts`
- Reuse: `server/agent/harness/invocation-execution-lease.ts`
- Reuse: `shared/agent/agent-image-markdown.ts`

**Service boundary:**

```ts
export class CandidateReviewService {
    async start(input: {
        projectPath: string;
        ownerUserId: number;
        assetIds: string[];
    }): Promise<CandidateReviewDto>;

    async resume(input: {
        projectPath: string;
        ownerUserId: number;
        reviewId: string;
    }): Promise<CandidateReviewDto>;

    async retry(input: {
        projectPath: string;
        ownerUserId: number;
        reviewId: string;
    }): Promise<CandidateReviewDto>;

    async read(input: {
        projectPath: string;
        ownerUserId: number;
        reviewId: string;
    }): Promise<CandidateReviewDto>;

    async list(input: {
        projectPath: string;
        ownerUserId: number;
        page: number;
        pageSize: number;
    }): Promise<CandidateReviewPageDto>;

    async tick(input: {
        projectPath: string;
        ownerUserId: number;
    }): Promise<number>;
}
```

- [ ] **Step 1: Write failing Profile and service tests**

Use a fake Harness with durable admissions/results plus real temporary files and
repository. Cover:

- Profile Initial accepts only strict Candidate Review metadata;
- real `review-candidates` runtime tool list is exactly `["report_result"]`;
- output union uses the strict review output schema;
- no Planning bundle, placeholder text, Project path, Recipe, Provider, or
  generation parameter enters Initial;
- service sorts/freeze assets before creating a session;
- 2–8 images are snapshotted and placed in the prompt in persisted ordinal order;
- restart after Session creation or a partial attachment snapshot reuses the
  recorded Session/attachment IDs, snapshots only missing ordinals, and invokes
  at most once;
- crash after Session creation but before Project attempt writeback reacquires
  the same tagged Session;
- crash after Harness durable admission but before `onAccepted` Project CAS is
  recovered by reading the deterministic Session/client message before any new
  invoke;
- sidecar loss/corruption after the Session lease-established marker but before
  `onAccepted` yields `null` and legally moves the still-`attaching` attempt to
  `outcome_unknown`; it never gets stuck waiting for a `running`-only CAS;
- hard Harness reconstruction after admission/before `onAccepted`, and after
  `onAccepted`/before Provider start, expires and fences the general execution
  lease as `orphaned`; both become stable failed with zero continuation
  invocation;
- an orphan with `providerStartRecorded: false` becomes retryable `failed`,
  while `providerStartRecorded: true | null` becomes terminal
  `outcome_unknown`; start/resume/API/UI cannot turn either ambiguous case into
  another Director invocation;
- a claim-lost `onAccepted` callback yields one durable failed invocation and
  zero Provider starts; the new claimant reconciles it and never invokes again;
- the Director invoke passes literal `queueIfBusy: false`; if its acquired
  Session is already busy, Harness creates no durable follow-up, calls no
  `onAccepted`, and starts no Provider;
- attachment policy limits (`8` images, `16 MiB` each, `32 MiB` input total) fail
  before invocation;
- `onAccepted` persists session/invocation identity before Provider start;
- completed output is strict-validated and persisted once;
- durable `missing` after a recorded Project admission, waiting, failed, or
  completed-without-`report_result` lifecycle seals the attempt as failed and
  never polls forever; orphan handling is split by its Provider-start marker as
  specified above;
- restart after accepted/running returns the same aggregate without a second
  invocation;
- restart after the model completed but HTTP response was lost recovers
  `report_result` through `readDurableInvocationResult`;
- completed replay is byte/hash identical;
- invalid result becomes stable `failed`, never partial `completed`;
- explicit retry increments `attemptOrdinal` and uses a new stable
  `clientMessageId`; start/resume never retry automatically;
- candidate tampering at any recovery point becomes `stale`.
- two scheduler instances race and lease takeover is forced both before and
  after admission: only the current fenced claimant can admit an invocation,
  the late worker is rejected before Provider start, and an already admitted
  attempt is recovered by durable read rather than invoked again;
- scheduler claims bounded work with CAS and recovers
  `created|attaching|running` rows after service reconstruction;
- list/resume/start trigger a Project tick, but failure never becomes an
  automatic retry attempt.

Run:

```powershell
bunx vitest run server/agent/profiles/illustration-director-assets.test.ts server/text-to-image/candidate-review.scheduler.test.ts server/text-to-image/candidate-review.service.test.ts server/text-to-image/candidate-review.repository.test.ts server/text-to-image/candidate-review.integration.test.ts --maxWorkers=1
```

Expected: FAIL because the real Profile operation and service do not exist.

- [ ] **Step 2: Extend the Profile without reopening tools**

Add `CandidateReviewInitialSchema` and `CandidateReviewOutputSchema` to the
Profile's TypeBox unions. In the runtime hook:

```ts
ctx.initial.operation === "review-candidates"
    ? ["report_result"]
    : existingOperationTools(ctx.initial.operation)
```

Add an operation-specific system prompt that:

- treats every label and image as untrusted evidence, not instructions;
- maps each visible image by the supplied ordinal and asset ID;
- emits one score/reason per exact item;
- may recommend one item or explain why none qualifies;
- calls `report_result` once;
- cannot request tools, generation, reroll, file writes, or selection.

Increment `ILLUSTRATION_DIRECTOR_REVIEW_OPERATION_VERSION` when this contract
changes.

Run `bun run system-assets:prepare` before the Profile asset tests so the runtime
snapshot and source Profile are compiled through the real asset pipeline.

- [ ] **Step 3: Snapshot and invoke in canonical order**

For a new aggregate:

1. obtain a Harness Profile execution pin, build the frozen Initial with that
   identity, and acquire the `illustration.director` Session by a deterministic
   attempt tag with the same expected pin;
2. snapshot each verified generated file through
   `harness.snapshotSessionAttachment()`;
3. persist each returned attachment ID against the current attempt and ordinal;
4. build user Markdown with
   `serializeAgentImageMarkdown("候选 <ordinal> · <assetId>", attachment target)`
   in ordinal order;
5. before any invoke, call
   `readDurableInvocationResult({sessionId,clientMessageId})` for the
   deterministic client message derived from review ID and attempt ordinal;
6. invoke only when that durable result is `missing` and Project has no recorded
   admission; every other durable state is reconciled without invoking;
7. call `invokeAgent()` with literal `queueIfBusy: false` and persist admission
   through the fenced `onAccepted`;
8. validate the completed `report_result`, compute `reviewHash`, and CAS to
   completed.

`invokeAgent()` must receive `queueIfBusy: false` and call `onAccepted` before
Provider start. The general Harness type/runtime contract rejects a hooked
invocation that could enter the durable follow-up queue. That callback CASes the
current attempt ID + `claimId` + `claimFence`, requires no prior admission, and
atomically stores Session/client/invocation identity plus
`acceptedClaimFence`. A stale claimant throws
`CANDIDATE_REVIEW_CLAIM_LOST`; the Harness must abort before Provider start.
Deterministic `clientMessageId` is evidence, not assumed Harness idempotency.
The Harness writes durable admission before calling `onAccepted`; therefore a
callback failure can leave a durable failed invocation with no Project
admission. The mandatory pre-invoke durable read closes that crash window.
Likewise, a claimant that loses a same-attempt Harness busy/admission race must
re-read the deterministic Session/client message before changing Project state.
It reconciles the winning durable invocation and never treats “not queued” as
permission to create a second invocation.

If the pin changes before admission, persist a stable failed attempt with zero
Provider start. Any explicit retry from `failed` creates a new attempt and may
obtain the then-current pin, even when an older failed attempt had been
accepted; the old attempt's accepted pin and invocation identity remain
immutable. Active or ambiguous attempts cannot be retried. Completion copies
only the winning attempt identity onto the review aggregate.

The Project record stores attachment IDs only. Attachment bytes remain owned by
the existing Workspace Root Agent attachment store.

- [ ] **Step 4: Implement restart recovery**

`start()` is create-or-resume by candidate set. The bounded
`CandidateReviewScheduler` is the sole attempt runner; service start/list/resume
calls trigger `tick()` so an open Project recovers durable work after restart.
Each tick claims at most a fixed small batch through the repository lease
protocol and passes the returned claim token to every mutation. Before
admission, an expired lease may be taken over and the old worker loses its
fence. After admission, a new claimant may only read/finalize the durable
Session result; it must never call `invokeAgent()` again. A worker whose lease
expires while the Provider is running may return a result, but its stale
finalization CAS is ignored and the current claimant performs recovery.
`resume()`:

- returns completed/terminal rows unchanged;
- resumes `attaching` from persisted per-ordinal attachment IDs without
  duplicating already snapshotted images;
- invokes once when all attachments exist but no admission was recorded;
- always reads the durable invocation result when the deterministic
  Session/client message exist, even if Project admission fields are empty;
- only durable `missing` plus no Project admission may invoke; `active` is
  live by definition and is reconciled as running; `waiting`, `failed`, and
  `completed_without_result` become stable failed, and `completed` is
  validated/finalized;
- durable `missing` after Project admission is stable
  `CANDIDATE_REVIEW_DURABLE_INVOCATION_MISSING`, never permission to invoke;
- durable `orphaned` with `providerStartRecorded: false` is stable retryable
  `failed` with
  `CANDIDATE_REVIEW_INVOCATION_ORPHANED_BEFORE_PROVIDER`; the Harness fence
  proves the abandoned owner cannot start later. With
  `providerStartRecorded: true | null`, it becomes terminal `outcome_unknown` with
  `CANDIDATE_REVIEW_INVOCATION_OUTCOME_UNKNOWN`; the marker stays internal and
  no start/resume/retry path may create another attempt;
- leaves admitted/running work as running;
- finalizes a recovered completed result without invoking again;
- maps durable waiting/failed/completed-without-result to a stable failed
  attempt that only explicit `retry()` may replace;
- maps missing/corrupt candidate files to stale;
- never turns a model/session failure into an automatic new attempt.

Only `retry()` may start a new attempt, and only from `failed`.
`outcome_unknown` is immutable because a Provider call may already have run.

- [ ] **Step 5: Run Profile/service/recovery tests**

Run the Step 1 command again plus:

```powershell
bunx vitest run server/agent/harness/invocation-execution-lease.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/attachments/agent-attachment-codec.test.ts server/agent/harness/session-attachment.test.ts --maxWorkers=1
```

Expected: PASS; invocation count remains one across restart recovery.

- [ ] **Step 6: Commit the Director slice**

Suggested commit:

```text
feat(text-to-image): review candidate images with director
```

---

### Task 6: Make user selection a one-time promotion transaction

**Files:**

- Create: `server/text-to-image/candidate-selection.service.ts`
- Create: `server/text-to-image/candidate-selection.service.test.ts`
- Modify: `server/text-to-image/candidate-review.repository.ts`
- Modify: `server/text-to-image/candidate-review.repository.test.ts`
- Modify: `server/text-to-image/reference-promotion.service.ts`
- Modify: `server/text-to-image/reference-promotion.service.test.ts`
- Modify: `server/text-to-image/reference-asset.service.ts`
- Modify: `server/text-to-image/reference-asset.service.test.ts`

**Selection request:**

```ts
export const CandidateSelectionRequestSchema = z.object({
    expectedReviewHash: TextToImageContractHashSchema,
    selectedAssetId: StableIdSchema.nullable(),
    reason: z.string().trim().min(1).max(2000),
}).strict();

export class CandidateSelectionService {
    async select(input: {
        projectPath: string;
        ownerUserId: number;
        reviewId: string;
        expectedReviewHash: string;
        selectedAssetId: string | null;
        reason: string;
    }): Promise<CandidateSelectionReceiptDto>;
}
```

`requestHash` is `hashTextToImageContract()` over this exact canonical object:

```text
selectionRequestVersion = CANDIDATE_SELECTION_REQUEST_VERSION
reviewId
expectedReviewHash
selectedAssetId (explicit null when dismissed)
reason (after schema trim)
actorUserId (server-derived)
```

Tests prove surrounding whitespace normalizes to the same replay, while any
review, review hash, selected/null choice, normalized reason, actor, or version
change produces a different hash. No Project path, timestamp, promotion result,
or client-provided identity participates.

- [ ] **Step 1: Write failing selection race tests**

Cover:

- recommendation can be accepted;
- a different in-set candidate can be accepted;
- null closes the review without a promotion;
- outside-set candidate, stale/missing file, non-completed review, and stale
  `expectedReviewHash` fail;
- first terminal selection wins;
- exact replay returns the same selection/promotion receipt;
- request-hash normalization/version/actor tests match the frozen preimage;
- two concurrent different selections yield one success and one stable conflict;
- the same generated asset selected from two different completed reviews reuses
  one P5 promotion row, while both selection rows independently preserve their
  review/actor/reason lineage;
- promotion lineage and selection commit in the same Project transaction;
- transaction failure creates no selection, reference, or promotion row; a
  verified content-addressed orphan file may remain and the next explicit replay
  adopts it through the P5 promotion protocol;
- a selected candidate cannot later be deleted;
- selection does not edit manuscript, Storyboard, Recipe, Job, or Manifest.

Run:

```powershell
bunx vitest run server/text-to-image/candidate-selection.service.test.ts server/text-to-image/reference-promotion.service.test.ts server/text-to-image/candidate-review.repository.test.ts server/text-to-image/reference-asset.service.test.ts --maxWorkers=1
```

Expected: FAIL because there is no selection service.

- [ ] **Step 2: Compose the P5 scoped lock and promotion**

Use one `withTextToImageReferenceMutationLock(projectPath, ...)` scope:

1. re-read the completed review and exact `reviewHash`;
2. strict-parse/canonicalize the request and derive `requestHash`;
3. return an existing byte-identical replay;
4. reject an existing different terminal request;
5. if selected, call P5 `prepareGeneratedPromotion()` while the lock is held;
6. open one Project transaction;
7. call `commitPreparedPromotion({transaction, prepared})`, which reuses the
   promotion keyed by generated asset rather than by selection;
8. insert the selection and CAS review status to `selected`;
9. for null, insert selection and CAS to `dismissed` without promotion.

The P5 promotion API must be obtained from the current lock scope so this code
does not reacquire the same lock. `promotionId` is intentionally non-unique on
the selection table: the selection row, not the shared promotion row, is the
audit owner of each user's terminal choice.

- [ ] **Step 3: Return a strict terminal receipt**

Return selection ID, review ID/hash, selected asset ID or null, promotion/reference
metadata or null, actor, reason, and timestamp. Do not return paths or raw
promotion internals.

- [ ] **Step 4: Run the selection suite**

Run the Step 1 command again.

Expected: PASS, including the real concurrent CAS test.

- [ ] **Step 5: Commit the selection slice**

Suggested commit:

```text
feat(text-to-image): select and promote one reviewed candidate
```

---

### Task 7: Add strict APIs and a focused history/detail review UI

**Files:**

- Create: `server/api/text-to-image/candidate-reviews/index.post.ts`
- Create: `server/api/text-to-image/candidate-reviews/index.get.ts`
- Create: `server/api/text-to-image/candidate-reviews/[reviewId]/index.get.ts`
- Create: `server/api/text-to-image/candidate-reviews/[reviewId]/resume.post.ts`
- Create: `server/api/text-to-image/candidate-reviews/[reviewId]/retry.post.ts`
- Create: `server/api/text-to-image/candidate-reviews/[reviewId]/select.post.ts`
- Create: `server/api/text-to-image/candidate-batches/index.get.ts`
- Create: `server/api/text-to-image/candidate-reviews/candidate-review-api-contract.test.ts`
- Create: `server/text-to-image/candidate-review-http-error.ts`
- Create: `server/text-to-image/candidate-review-http-error.test.ts`
- Create: `server/text-to-image/candidate-batch-query.service.ts`
- Create: `server/text-to-image/candidate-batch-query.service.test.ts`
- Create: `app/utils/text-to-image-candidate-review.ts`
- Create: `app/utils/text-to-image-candidate-review.test.ts`
- Create: `app/components/novel-ide/text-to-image/TextToImageCandidateReviewPanel.vue`
- Modify: `app/components/novel-ide/text-to-image/TextToImageHistoryWorkspace.vue`
- Modify: `app/components/novel-ide/text-to-image/TextToImageAssetDetailDialog.vue`
- Create: `server/text-to-image/candidate-review-ui-contract.test.ts`

- [ ] **Step 1: Write failing API/client/UI contract tests**

Prove:

- every route requires current user and an open Project;
- server derives owner user, Project identity, assets, hashes, and status;
- start accepts only `projectPath + assetIds`;
- select accepts only the strict terminal request;
- retry accepts only `failed` and rejects `outcome_unknown` without creating an
  attempt or invoking the Director;
- list/read DTOs contain safe metadata and asset IDs, not Project paths,
  server-built URLs, or Base64; the client helper uses its host-held
  `projectPath` to build the existing content request;
- Candidate Batch History paginates by terminal candidate Job and returns each
  Job's complete ordered `2..8` asset closure; page boundaries can never split a
  batch and the query does not depend on the generic History `60`-row window;
- a candidate-generation preview from Asset Detail shows output count and
  conservative lower bounds before the paid authorization;
- “创建候选组” is visible only for an eligible successful P5 placeholder-v2
  source asset; candidate-batch outputs never become nested generation sources;
- Candidate Batch DTOs expose their safe `sourceAssetId`, so History/detail can
  navigate back to that original source for a separately previewed new batch;
- History groups assets by candidate Job/revision and allows selecting a 2–8 item
  subset in canonical order;
- running state resumes/polls; failed state offers explicit retry; stale state
  cannot retry or select; `outcome_unknown` clearly says the Director may have
  started and is read-only with no retry, resume, or selection control;
- completed state shows every score/reason and clear Director recommendation;
- user may choose any candidate or “结束且不选择” and must enter the terminal
  selection reason (`1..2000` characters);
- after a terminal choice, controls are read-only;
- no automatic reroll/generate/select action exists.

Run:

```powershell
bunx vitest run server/text-to-image/candidate-review-http-error.test.ts server/api/text-to-image/candidate-reviews/candidate-review-api-contract.test.ts server/text-to-image/candidate-batch-query.service.test.ts app/utils/text-to-image-candidate-review.test.ts server/text-to-image/candidate-review-ui-contract.test.ts --maxWorkers=1
```

Expected: FAIL because routes/component do not exist.

- [ ] **Step 2: Implement route error boundaries**

Map stable domain errors:

- invalid/mixed set: `400`;
- missing review/asset: `404`;
- unconfigured Director: `409`;
- stale/tampered candidates: `409`;
- stale review hash or competing selection: `409`;
- attachment budget violation: `413`;
- unexpected failure: existing safe API error path.

Never expose Agent prompt, Project request JSON, or credentials.
All Candidate Review routes use the one shared
`candidate-review-http-error.ts` mapper; handlers do not duplicate Prisma/domain
error parsing.

Freeze route ownership:

| Route | Strict Project input | Success |
|---|---|---|
| `POST /candidate-reviews` | body `{projectPath, assetIds}` | `202 CandidateReviewDto` |
| `GET /candidate-reviews` | query `{projectPath, page, pageSize}` | `200 CandidateReviewPageDto` |
| `GET /candidate-reviews/:reviewId` | query `{projectPath}` | `200 CandidateReviewDto` |
| `POST /candidate-reviews/:reviewId/resume` | body `{projectPath}` | `202 CandidateReviewDto` |
| `POST /candidate-reviews/:reviewId/retry` | body `{projectPath}` | `202 CandidateReviewDto` |
| `POST /candidate-reviews/:reviewId/select` | body `{projectPath, expectedReviewHash, selectedAssetId, reason}` | `200 CandidateSelectionReceiptDto` |
| `GET /candidate-batches` | query `{projectPath, page, pageSize}` | `200 CandidateBatchPageDto` |

Every route requires the current user, asserts that the exact `projectPath` is
the open Project, derives `ownerUserId` server-side, and rejects unknown fields.
`CandidateReviewService.read()` owns detail reads; only
`CandidateSelectionService.select()` owns terminal selection.

`CandidateBatchPageDto` is a strict `{items,page,pageSize,hasMore}` page over
Jobs. Each item freezes `jobId`, `compiledRevision`, `createdAt`, and a complete
ordered asset array `{ordinal,assetId}`, plus the frozen original
`sourceAssetId`. The query parses and verifies
the terminal Job fence plus `resultAssetIdsJson` closure before returning a
group; malformed/partial jobs are not projected as selectable batches.

- [ ] **Step 3: Build one reusable review component**

`TextToImageCandidateReviewPanel.vue` owns the focused start/status/result/select
flow and emits `changed`. History and detail hosts pass a candidate Job/group or
source asset. Use current theme variables, `useNotification()`, and
`resolveApiErrorMessage()`. The client utility has one tested helper that safely
encodes host-held `projectPath` plus `assetId` into the existing
`/api/text-to-image/assets/:id/content` request; the server DTO never embeds the
path.

Asset Detail adds an explicit “创建候选组” action with a count `2..8` only when
the asset is an eligible successful P5 placeholder CompiledRequest v2 source; it
uses the signed candidate preview and existing confirmation pattern. History
displays the resulting group from the dedicated Job-paginated projection and
mounts the review panel. Candidate outputs show a “查看原始插图” navigation using
the server-derived `sourceAssetId`, never a nested generation action. For
`TEXT_TO_IMAGE_CANDIDATE_JOB_KIND`/`TEXT_TO_IMAGE_CANDIDATE_ASSET_SOURCE_KIND`,
hide “创建候选组” plus the old generic retry, restore, and manuscript-insert
controls. To request another paid batch, the user explicitly returns to the P5
source and completes a new signed Preview/confirmation. Do not overload the
normal placeholder generation button.

- [ ] **Step 4: Run API/UI tests**

Run the Step 1 command again.

Expected: PASS.

- [ ] **Step 5: Commit the product slice**

Suggested commit:

```text
feat(text-to-image): expose durable candidate review
```

---

### Task 8: Verify P6 and the P5/P6 ownership boundary

**Files:**

- Modify only when a verification failure proves a P6 defect.
- Final repository status/walkthrough updates remain owned by the delivery index.

- [ ] **Step 1: Re-run every Task 1–7 GREEN command**

Run each focused command exactly as recorded in Tasks 1–7, including Candidate
generation API, queue/dispatch recovery, Harness pinning, Project initializer,
HTTP error, complete Candidate Batch query, UI contract, and the already
implemented Task 5 no-network integration tests. Then run the end-to-end owner
once more in isolation:

```powershell
bunx vitest run server/text-to-image/candidate-review.integration.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 2: Run static ownership and secrecy scans**

```powershell
$hits = rg -n --glob '!**/*.test.ts' "review-candidates|review_candidates|skipApplyToReady|list_chapter_illustrations|get_illustration_detail" shared/text-to-image-illustration-planning.ts shared/text-to-image-illustration-workflow.ts server/text-to-image/illustration-planning-input.builder.ts server/text-to-image/illustration-plan-validator.ts server/text-to-image/illustration-workflow.scheduler.ts server/text-to-image/illustration-workflow.repository.ts server/agent/tools prisma/project.schema.prisma; if ($LASTEXITCODE -eq 0) { $hits; throw "fake Planning/tool owner remains" }; if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
$hits = rg -n --glob '!**/*.test.ts' "imageDataUrl|data:image|base64|absolutePath|credential|recipeSnapshot|requestJson" shared/text-to-image-candidate-review.ts server/api/text-to-image/candidate-reviews app/utils/text-to-image-candidate-review.ts app/components/novel-ide/text-to-image/TextToImageCandidateReviewPanel.vue; if ($LASTEXITCODE -eq 0) { $hits; throw "public candidate contract leaks private data" }; if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
$hits = rg -n --glob '!**/*.test.ts' "replaceIllustrationPrompt|restoreIllustrationPrompt|reroll|auto.*select|auto.*generate" server/text-to-image/candidate-review.service.ts server/text-to-image/candidate-review.scheduler.ts server/text-to-image/candidate-selection.service.ts app/components/novel-ide/text-to-image/TextToImageCandidateReviewPanel.vue; if ($LASTEXITCODE -eq 0) { $hits; throw "candidate domain contains forbidden automatic/manuscript action" }; if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
```

Expected:

- fake Planning/tool scan has zero hits;
- secrecy scan has zero public contract/API/client hits;
- candidate domain has no manuscript replacement or automatic action.

- [ ] **Step 3: Regenerate, typecheck, and build**

Run outside the sandbox where required:

```powershell
bun run generate
bun run typecheck
bun run build
bun run nuxt:build
bun run product:stage
```

Expected: every command exits `0`; Agent Profile artifact, Prisma client,
Nuxt/Nitro, and staged product all build.

- [ ] **Step 4: Perform the automated no-network durable smoke**

Re-run the Task 5 `candidate-review.integration.test.ts`, already implemented
with fixed synthetic image bytes and a fake Agent runtime, and audit that it:

1. create a 2-image candidate Job/result;
2. start review and stop after durable admission;
3. reconstruct services and recover one completed `report_result`;
4. select the non-recommended candidate;
5. restart and replay the same selection;
6. verify one review, one selection, one promotion, and no manuscript change.

Do not automate the browser and do not send a NovelAI request.

- [ ] **Step 5: Request independent review**

The reviewer compares the implementation with approved specification sections
9, 11, 12.3, and 13.4 and reports:

- any remaining fake Planning review owner;
- any way to review mixed revisions or reorder image/score identities;
- any second Agent invocation during recovery;
- any tool beyond `report_result`;
- any Base64/path/credential/Recipe leakage;
- any multi-output partial-success review;
- any selection race or promotion outside the terminal transaction;
- any manuscript mutation or automatic reroll.

Resolve every blocking finding and rerun Tasks 1–8 before Workflow history hiding.
