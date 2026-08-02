# Text-to-Image P5/P6 Delivery Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the six approved text-to-image outcomes as five reviewed vertical slices, then prove the combined production graph has no old overlay, migration-review, or fake candidate-review ownership.

**Architecture:** Execute the subsystem plans serially at their shared ownership boundaries: global Storyboard truth first, character direct-write second, P5 reference/capability execution third, P6 multi-output and durable review fourth, and display-only Workflow history hiding last. Each slice lands with focused tests and a review gate; one final integration task regenerates derived clients/assets, runs the broad suite/build, audits the approved specification, and updates the single repository status/walkthrough owners.

**Tech Stack:** TypeScript, Zod, Prisma 7 Project SQLite, Nuxt/H3, Vue 3, Pinia, NovelAI adapter, Agent Harness, Vitest, Bun.

## Source of Truth

- Approved specification:
  `docs/superpowers/specs/2026-07-27-text-to-image-p5-p6-direct-generation-design.md`
- Subsystem plans:
  1. `docs/superpowers/plans/2026-07-27-project-storyboard-overlay-removal.md`
  2. `docs/superpowers/plans/2026-07-27-character-visual-direct-generation.md`
  3. `docs/superpowers/plans/2026-07-27-text-to-image-p5-reference-capabilities.md`
  4. `docs/superpowers/plans/2026-07-27-text-to-image-p6-candidate-review.md`
  5. `docs/superpowers/plans/2026-07-27-illustration-workflow-history-clear.md`

If an older task plan conflicts with the approved specification or these five
plans, the approved specification wins.

## Global Constraints

- Use TDD inside every subsystem plan: observe the named RED failure before
  implementation, then run the named GREEN and regression gates.
- Do not execute the five plans concurrently. They intentionally share production
  files and Prisma generated output.
- Do not add compatibility readers, data migrations, or old-format branches for deleted
  Project overlays, character migration/proposal records, or fake Planning review.
- Preserve existing user-authored `image-tags.md`, `outfits/*.md`, and inert
  historical control files; deleting production readers is not permission to
  delete user data.
- Keep the real `.naiv4vibe` sample private and outside committed fixtures. Only
  deterministic synthetic fixtures may enter the repository.
- Do not run browser automation or a real NovelAI paid generation smoke unless the
  user separately asks for it.
- If image decoding requires a new dependency, install the latest version with
  Bun outside the sandbox and record the Product/Nitro packaging result.
- Run every `bun`/`bunx` command in this index and its subsystem plans outside
  the sandbox, per repository policy.
- Regenerate `server/generated/project-prisma/**`; never hand-edit it.
- Record exact pre-existing failures. A command with unrelated baseline failures
  is not reported as a clean pass.

## Serial Ownership Map

| Shared owner | First writer | Later writer | Required handoff |
|---|---|---|---|
| `NovelTextToImagePanel.vue` | Overlay plan | Character plan | Overlay removes only overlay state/component; character then removes migration UI. |
| `illustration-planning-input.builder.ts` | Overlay plan | P6 plan | Global snapshot cutover lands before fake `review-candidates` removal. |
| `illustration-execution.compiler.ts` | Overlay plan | P5, then P6 | Global rules first; capability/reference preflight second; multi-output identity last. |
| `shared/agent/illustration-director.ts` and built-in Profile | Character plan | P6 plan | P6 preserves direct character operation while adding independent review contract/tool gate. |
| Agent Harness durable seams | Character plan | P6 plan | Add general tagged Session acquisition, admission/result recovery, and execution lease/orphan fence first; P6 reuses them and adds one general Profile execution pin/verify seam, never a review-only duplicate. |
| `prisma/project.schema.prisma` / `project-workspace.ts` | P5 plan | P6, then Workflow plan | Apply ordered idempotent Project initializer helpers and run `bun run generate` after each schema slice. |
| `asset.service.ts` / reference promotion | P5 plan | P6 plan | P5 exposes transaction-capable prepare/commit primitives; P6 composes them with selection CAS. |
| `server/generated/project-prisma/**` | Every DB slice | Next DB slice | Accept only command-generated changes from the current schema. |
| Repository status and walkthrough docs | Delivery index only | None | Subsystem plans collect evidence; final task performs the single documentation update. |

Project SQLite upgrade order is fixed:

1. `ensureTextToImageP5ReferenceSchema()`
2. `ensureTextToImageP5ExecutionSchema()`
3. `ensureTextToImageP5GeneratedAssetSchema()`
4. `removeFakeCandidateReviewPlanningRows()`
5. `ensureTextToImageCandidateGenerationSchema()`
6. `ensureTextToImageCandidateReviewSchema()`
7. `ensureIllustrationWorkflowHistorySchema()`

P5 owns reference source/encoding/promotion storage. P6 owns generated-candidate
evidence, multi-output grouping and candidate review/result/selection records.
P6 extends generated-asset deletion checks with its candidate/selection tables;
reference-asset deletion remains owned by P5 promotion
`referenceContentHash`. Every
schema slice updates `prisma/project.schema.prisma`, `PROJECT_MIGRATION_SQL`, its
idempotent old-Project helper, initializer tests, and generated Project client.
Do not add an App SQLite `prisma/migrations/sqlite` file for Project data.

## Requirement Coverage

| Approved outcome | Owning plan | Completion evidence |
|---|---|---|
| P5 capability, strict references, dual Inpaint, Vibe import/cache, promotion and safe delete | P5 | Registry/compiler/service/adapter tests, synthetic container conformance, build/product staging |
| P6 same-revision 2–8 candidates and one-time durable review/selection | P6 | Multi-output registration tests, strict review closure/hash tests, restart recovery, selection+promotion transaction tests |
| Direct character Tag generation and exact outfit files | Character | Harness recovery, materializer/codec, journal crash recovery, API/UI and static removal gates |
| Remove Project Storyboard/Pattern overlay but retain global pair | Overlay | Global snapshot consumer tests plus zero-production-owner scan |
| Import `.naiv4vibe` and identical `.vibe` alias | P5 | Real-sample private conformance plus committed synthetic strict parser tests |
| Remove character/outfit V2 migration control plane | Character | Deleted owner/path assertions while V2 registry/codec tests remain |
| Clear finished illustration Workflow history | Workflow | Real SQLite hide/replay tests and hidden-ready continuity baseline test |

---

### Task 1: Execute and review the global Storyboard truth cutover

**Files:**

- Follow:
  `docs/superpowers/plans/2026-07-27-project-storyboard-overlay-removal.md`
- Review evidence only; do not update final repository status docs yet.

- [ ] **Step 1: Execute the overlay-removal plan task by task**

Expected terminal state:

- Planning and Compiler both consume `StoryboardPlanningSnapshotService`;
- all Project overlay production/UI/API/schema owners are gone;
- global selector/default/import/publish infrastructure remains;
- historical Project files are untouched.

- [ ] **Step 2: Run the plan's focused suite and ownership scans**

Expected: all named tests PASS; the production scan has zero overlay matches and
the preserved-global scan identifies both consumers.

- [ ] **Step 3: Request an independent code review**

The reviewer compares the diff with specification sections 2.4 and 7 and reports:

- any remaining production path that can read or write a Project overlay;
- any accidentally removed global selector/import/publish/default capability;
- any stale-hash check weakened by the cutover.

Resolve every blocking finding and rerun the focused suite before starting Task 2.

---

### Task 2: Execute and review character visual direct-write

**Files:**

- Follow:
  `docs/superpowers/plans/2026-07-27-character-visual-direct-generation.md`
- Start from Task 1's updated `NovelTextToImagePanel.vue`.

- [ ] **Step 1: Execute the character plan task by task**

Expected terminal state:

- one explicit click creates one idempotent direct-write operation;
- Director admission/session identity is durable before inference;
- hooked Director calls pass `queueIfBusy: false`, and Harness terminal writes
  are fenced across the execution sidecar and Session mutation boundary;
- restart reads the deterministic Session/client message before any possible
  invoke, including the crash window before journal admission writeback;
- a live reconstructed operation is observed for at most the fixed HTTP wait
  budget, then returns a retryable in-progress conflict instead of hanging;
- a persisted result resumes without invoking the model again;
- `block` fails all, `review_required` is excluded with diagnostics, and allowed
  passthrough follows Project policy;
- outfits use strict descriptive names and fixed V2 field order;
- no migration/proposal/review/preview UI or runtime owner remains.

- [ ] **Step 2: Run Profile asset generation before its tests**

Run outside the sandbox:

```powershell
bun run system-assets:prepare
```

Expected: exit `0`; the generated built-in profile reflects the direct character
contract without manual edits to generated assets.

- [ ] **Step 3: Request an independent code review**

The reviewer checks specification sections 2.1–2.3 and 5–6, especially:

- journal crash windows and CAS snapshots;
- outfit normalization collisions and cross-owner conflicts;
- `image-tags.md` written last;
- absence of fake `TagPolicyApproval`;
- preservation of V2 codec/schema/registry.

Resolve blocking findings and rerun the character focused suite.

---

### Task 3: Execute and review P5 reference/capability execution

**Files:**

- Follow:
  `docs/superpowers/plans/2026-07-27-text-to-image-p5-reference-capabilities.md`
- Start from Task 1's Compiler and Task 2's Harness/Profile state.

- [ ] **Step 1: Complete non-paid wire discovery before freezing Registry constants**

Use the private sample:

```text
C:\Users\admir\Downloads\6f233a-d45ae0.naiv4vibe
```

and the public NovelAI Image API schema/documentation. Record only structural
conclusions in tests/docs; do not commit source bytes, thumbnail, encoding,
hashes, IDs, keys, or identifying metadata. Do not inspect or automate the
signed-in browser as part of this plan.

Expected: the implemented model→wire model/action/bucket and encoder-version
constants are evidence-backed. If the public contract plus private sample does
not expose a required fact, stop that constant's implementation and report the
exact missing evidence rather than guessing or opening a browser.

- [ ] **Step 2: Execute the P5 plan task by task**

Expected terminal state:

- Preview runs the single Registry preflight and freezes its evidence;
- Inpaint is a base+mask pair with strict MIME/decode/dimension checks;
- Project references are byte-addressed and atomically stored under `.nbook`;
- `.naiv4vibe` and `.vibe` import all-or-nothing;
- wire-equivalent imported encodings share the versioned cache;
- payload bytes are read only after `attempt_started` and Base64 encoded once;
- P5 exposes transaction-capable promotion primitives;
- safe delete protects every owner available at this stage.

- [ ] **Step 3: Run packaging gates required by image decoding**

Run outside the sandbox:

```powershell
bun run nuxt:build
bun run product:stage
```

Expected: both commands exit `0`. If a native image decoder fails to package, fix
the packaging design before continuing to P6.

- [ ] **Step 4: Request an independent code review**

The reviewer checks specification sections 8–10 and verifies:

- no second capability registry exists;
- no browser-supplied MIME/kind/encoding is trusted;
- final-file conflict handling never deletes another writer's file;
- cache identity includes provider/model/info/encoderVersion;
- promotion can join a caller-owned Prisma transaction.

Resolve blocking findings and rerun the P5 focused suite and packaging gates.

---

### Task 4: Execute and review P6 multi-output and durable candidate review

**Files:**

- Follow:
  `docs/superpowers/plans/2026-07-27-text-to-image-p6-candidate-review.md`
- Reuse the P5 Project lock, content verification, and promotion transaction
  primitives.

- [ ] **Step 1: Land the multi-output generation prerequisite first**

Expected terminal state:

- a user explicitly requests 2–8 outputs in one frozen Preview/authorization;
- all outputs share manifest, shot, placeholder, compiled request hash and
  compiled revision;
- the one candidate Job owns exact ordered asset `outputIndex=0..N-1`;
- authorization uses the conservative lower bound for the full requested count;
- after `attempt_started`, the candidate Job never enters Provider-lane retry;
  a new paid attempt requires a new Preview/authorization;
- Provider batching does not create a new revision and no automatic reroll exists.

Do not begin the review-domain GREEN implementation until production tests can
create a valid same-group 2–8 asset set.

- [ ] **Step 2: Execute the independent candidate-review tasks**

Expected terminal state:

- fake Planning `review-candidates` and its tools/state branches are gone;
- review owns no generation Job, Manifest, outbox, reroll or Planning record;
- 2–8 frozen images are injected exactly once in canonical ordinal order;
- restart recovery reads durable state before any continuation and fences
  orphaned Agent invocations instead of calling the model again;
- a pre-Provider orphan may become explicit-retry `failed`, while a
  post-Provider-start or execution-evidence-lost orphan is immutable
  `outcome_unknown`;
- validated output closes over every and only frozen candidate;
- one-time selection uses expected review hash and request-hash replay;
- non-null selection and P5 promotion lineage commit atomically;
- different reviews selecting the same generated asset retain separate
  selection rows while reusing one generated-asset promotion;
- UI allows any candidate or null, then becomes immutable.

- [ ] **Step 3: Extend P5 safe-delete coverage**

Add separate ownership cases:

- generated-asset deletion rejects a promotion, frozen Candidate Review, or
  terminal selection;
- reference-asset deletion rejects Recipe, Manifest, Vibe, or promotion owners;
- an unpromoted candidate with identical bytes is not misclassified as a
  reference owner;
- selections remain auditable through their shared `promotionId`.

- [ ] **Step 4: Request an independent code review**

The reviewer checks specification sections 11–13 and the newly discovered
multi-output prerequisite, especially:

- same manifest/shot/revision closure is proven from typed columns, not
  `originJson`;
- candidate/review hashes omit time/path/UI/session noise;
- output order and `assetId` closure are strict;
- response-loss recovery cannot invoke Director twice;
- two competing selections cannot both commit;
- selection failure leaves neither selection nor promotion lineage.

Resolve blocking findings and rerun the complete P6 focused suite.

---

### Task 5: Execute and review display-only Workflow history clearing

**Files:**

- Follow:
  `docs/superpowers/plans/2026-07-27-illustration-workflow-history-clear.md`
- Start after P6 removes the fake Planning operation.

- [ ] **Step 1: Execute the Workflow history plan task by task**

Expected terminal state:

- visible terminal rows are persistently hidden;
- active and protected terminal rows remain visible;
- repeated clear is replay-safe;
- duplicate start/retry makes a reused row visible;
- hidden `ready` plans remain available to continuity/publication/recovery reads.

- [ ] **Step 2: Request a focused repository/UI review**

The reviewer checks specification section 2.6 and confirms the action uses no
delete/cancel path and exposes no misleading “cleared data” wording.

Resolve blocking findings and rerun the Workflow focused suite.

---

### Task 6: Integrate, audit the specification, and update repository truth

**Files:**

- Modify: `PROJECT-STATUS.md`
- Modify: `docs/tasks/text-to-image-panel/README.md`
- Verify: all files changed by Tasks 1–5

- [ ] **Step 1: Regenerate all derived outputs from the final schema/Profile**

Run outside the sandbox:

```powershell
bun run generate
bun run system-assets:prepare
```

Expected: both commands exit `0`; rerunning them immediately produces no further
generated changes.

- [ ] **Step 2: Run the combined text-to-image suite**

Run outside the sandbox:

```powershell
bunx vitest run shared server/text-to-image server/api/text-to-image app/stores --maxWorkers=1
```

Expected: all relevant tests PASS. If unrelated tests in these broad roots have a
documented baseline, rerun every affected focused file and record the broad
failure verbatim; do not silently narrow the claim.

- [ ] **Step 3: Run type and product gates**

Run outside the sandbox:

```powershell
bun run typecheck
bun run nuxt:build
bun run product:stage
```

Expected:

- typecheck, build, and product staging all exit `0`.

- [ ] **Step 4: Run the combined removed-owner scan**

Run:

```powershell
$hits = rg -n "ProjectOverlay|project-overlays|StoryboardOverlay|TagPatternOverlay|character-visual-migrations|proposal_ready|review-candidates-stub|skipApplyToReady|illustration-review-tools" app shared server prisma --glob "!**/*.test.ts"; if ($LASTEXITCODE -eq 0) { $hits; throw "removed production owner remains" }; if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
```

Expected: no production matches. A retained V2 `policyApprovals` field is valid and
must not be banned globally.

Run:

```powershell
rg -n "StoryboardPlanningSnapshotService|character-visual-direct-write|preflightNovelAiCapabilities|encoderVersion|candidateSetHash|reviewHash|historyHiddenAt" app shared server prisma
```

Expected: every replacement owner appears in its planned production and test
locations.

- [ ] **Step 5: Perform a requirement-by-requirement specification audit**

For every heading in sections 2 and 5–14 of the approved specification, record:

- implementing file(s);
- proving test(s);
- verification result;
- any intentional plan deviation.

The audit fails if an item is represented only by a prompt comment, UI contract
test, or static token scan where runtime behavior is required.

- [ ] **Step 6: Update the repository status and ongoing walkthrough**

In `PROJECT-STATUS.md`:

- replace the entries that describe P5/P6 as future work with the verified
  current behavior;
- list only remaining real risks/TODOs;
- state that browser and paid NovelAI smoke were not automatically run.

In `docs/tasks/text-to-image-panel/README.md`, append:

- the six user goals;
- actual implementation sequence and key decisions;
- exact changed subsystem/file groups;
- focused and integration verification results;
- real-sample handling without private metadata;
- actual results versus these plans;
- limitations and follow-up work.

Do not update `RELEASE.md` unless the user also requests a release.

- [ ] **Step 7: Request final independent review**

Give the reviewer the approved specification, this index, the full implementation
diff, focused/broad test output, typecheck/build output and static scans. The
reviewer must return PASS or actionable findings grouped by the six approved
outcomes.

Resolve all blocking findings, rerun the affected focused suite and the combined
gates, then record the final evidence in the walkthrough.

- [ ] **Step 8: Commit the integration documentation**

```powershell
git add PROJECT-STATUS.md docs/tasks/text-to-image-panel/README.md
git commit -m "docs(text-to-image): record P5 P6 delivery"
```

The implementation is complete only after Tasks 1–6 and the final review pass. A
passing plan document or static scan alone is not completion evidence.
