# Character Visual Direct Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace character visual proposal/migration/review with one idempotent action that directly writes strict `image-tags.md` and descriptively named V2 outfit files, while preserving policy safety and crash recovery.

**Architecture:** Add one general Agent Harness admission/result-recovery seam, then build a Project-owned direct-write journal around the existing strict V2 codec, Tag Resolver and tracked writer. The Director returns only raw visual facts; the service resolves policy, renders every target, freezes source/target hashes, writes outfits first and `image-tags.md` last, and resumes from durable state without rerunning the model. Delete the complete migration/source/proposal control plane after the direct path is green.

**Tech Stack:** TypeScript, Zod, `@noble/hashes`, Agent Harness, Nuxt/H3, Vue 3, strict YAML codec, Vitest.

## Global Constraints

- Execute after the Project overlay-removal plan, because both edit
  `NovelTextToImagePanel.vue`.
- Keep the filename `image-tags.md`; do not rename it to singular
  `image-tag.md`.
- Keep `shared/text-to-image-character-visual.ts`, the V2 codec, registry,
  canonical hashes and `policyApprovals` field.
- Do not parse or migrate old character/outfit Tag formats. A direct generation
  may replace an old `image-tags.md`, but it never imports old values.
- Never manufacture `TagPolicyApproval`: `allow` and permitted passthrough write,
  `review_required` is excluded with diagnostics, and any `block` aborts the
  complete operation.
- Do not use numeric suffixes (`-2`, `-3`) to hide outfit-name collisions.
- Do not call the Director again after a durable completed result exists.
- Do not run browser verification automatically.
- Run every `bun`/`bunx` command in this plan outside the sandbox, per repository
  policy.

---

### Task 1: Add durable Agent session acquisition/admission/result seams

**Files:**

- Modify: `server/agent/harness/types.ts`
- Modify: `server/agent/harness/neuro-agent-harness.ts`
- Modify: `server/agent/harness/neuro-agent-harness.test.ts`
- Create: `server/agent/harness/invocation-execution-lease.ts`
- Create: `server/agent/harness/invocation-execution-lease.test.ts`

**Interfaces:**

```ts
export type AgentInvocationAdmission = {
    sessionId: number;
    invocationId: string;
    clientMessageId: string;
};

export type DurableInvocationResult =
    | {state: "missing"}
    | {
        state: "active";
        invocationId: string;
        lifecycle: "accepted" | "running";
        executionLeaseUntil: string;
    }
    | {
        state: "orphaned";
        invocationId: string;
        lifecycle: "accepted" | "running";
        /**
         * false = durable evidence proves Provider did not start;
         * true = start fence was recorded; null = execution evidence was lost/corrupt.
         */
        providerStartRecorded: boolean | null;
    }
    | {state: "waiting"; invocationId: string}
    | {state: "failed"; invocationId: string; errorInfo: InvocationErrorInfo | null}
    | {state: "completed_without_result"; invocationId: string}
    | {
        state: "completed";
        invocationId: string;
        reportResult: JsonValue;
    };

export type AcquireAgentInput = CreateAgentInput & {
    /** 内部工作流持久身份；同 Profile/scope/tag 必须返回同一未归档 Session。 */
    acquisitionTag: string;
};

export type AcquireAgentResult = CreateAgentResult & {
    reused: boolean;
};
```

Extend internal `InvokeAgentInput`:

```ts
/** admission 已持久化、Provider 尚未启动时调用；抛错会终止本次 invocation。 */
onAccepted?: (admission: AgentInvocationAdmission) => Promise<void>;
```

Make the hook/queue contract a discriminated union: callers without
`onAccepted` retain the existing optional `queueIfBusy`; callers with
`onAccepted` must pass the literal `queueIfBusy: false`. Enforce the same rule
at runtime before admission so JavaScript or stale generated callers cannot
bypass it. A hooked invocation that finds the Session busy fails closed; it is
never stored as a follow-up because a later drain would no longer own the
caller's admission callback/fence.

Add:

```ts
acquireAgent(input: AcquireAgentInput): Promise<AcquireAgentResult>;

readDurableInvocationResult(input: {
    sessionId: number;
    clientMessageId: string;
}): Promise<DurableInvocationResult>;
```

- [ ] **Step 1: Add failing Harness tests**

Add tests using a real session repository:

```ts
it("persists admission and runs onAccepted before the provider starts", async () => {
    const order: string[] = [];
    const result = await harness.invokeAgent({
        sessionId,
        mode: "prompt",
        queueIfBusy: false,
        clientMessageId: "character-direct-write-op-1",
        message: {text: "run"},
        onAccepted: async ({invocationId}) => {
            order.push(`accepted:${invocationId}`);
            expect(await repository.readSession(sessionId)).toBeDefined();
        },
    });
    expect(order[0]).toBe(`accepted:${result.invocationId}`);
    expect(providerStartedAfter(order)).toBe(true);
});
```

Also cover:

- `acquireAgent()` concurrently and after Harness reconstruction returns the
  same durable Session for the same Profile/scope/tag/strict Initial;
- same acquisition identity with different Initial fails closed;
- ordinary `createAgent()` behavior remains unchanged;
- the type/runtime contract rejects `onAccepted` without
  `queueIfBusy: false`; a busy hooked invocation creates no follow-up, calls no
  callback, and starts no Provider;
- `onAccepted` failure prevents a Provider call and seals an error lifecycle;
- completed `report_result.data` can be read by `sessionId + clientMessageId`
  after constructing a new Harness instance;
- admitted/running invocation returns `active`;
- an unexpired Harness execution lease returns `active`, while reconstructing
  after lease expiry returns `orphaned` with whether the Provider-start fence
  was recorded;
- hard reconstruction after durable admission/before `onAccepted`, and after
  `onAccepted`/before Provider start, both converge to `orphaned` and make zero
  continuation calls;
- the admission Session lock is released before execution-record creation; a
  competing orphan reader that wins that gap fences provider-not-started work,
  and the original caller aborts without deadlock or Provider start;
- first use initializes the stable lock target and empty v1 store before hooked
  admission; a later missing/malformed/unknown-version store is never
  auto-recreated or overwritten; known-bad preflight creates no Session
  admission, while corruption after preflight yields a fenced admitted failure
  with zero Provider calls;
- missing evidence before `execution_lease_established` returns orphaned with
  `providerStartRecorded: false`; missing/corrupt evidence after the marker
  returns `null`, while an already-terminal Session still returns terminal truth;
- deleting, replacing, corrupting, or downgrading the store after
  `providerStartedAt` was recorded returns `null` (or the intact exact `true`),
  never retryable `false`;
- when terminal commit acquires the execution lock first, a concurrent orphan
  detector waits, then observes Session terminal truth and only prunes the
  sidecar;
- when orphan fencing acquires the execution lock first, the old owner's late
  normal/error/waiting terminal commit fails before any Session terminal append;
- reconstruction after a crash between Session terminal append and sidecar
  pruning returns the Session terminal result and removes the stale sidecar;
- all composite paths obey execution-sidecar-before-Session lock ordering and
  complete under the adversarial interleavings above without deadlock;
- waiting, failed, and successful terminal lifecycle without `report_result`
  remain distinguishable after reconstruction;
- unknown session/message returns `missing`;
- a normal caller without the hook behaves exactly as before.

- [ ] **Step 2: Run the Harness test and confirm RED**

Run:

```powershell
bunx vitest run server/agent/harness/invocation-execution-lease.test.ts server/agent/harness/neuro-agent-harness.test.ts
```

Expected: FAIL because `acquireAgent()`, `onAccepted`, and
`readDurableInvocationResult()` do not exist.

- [ ] **Step 3: Implement idempotent internal Session acquisition**

Under the existing Harness relation-mutation serialization, look up an
unarchived Session by exact Profile, Workspace/Project scope, and
`acquisitionTag`. Strictly compare its parsed Initial hash before reuse; a
collision is a stable conflict. If absent, create one system/workflow Session
with that tag and return it. A newly reconstructed Harness must find the same
durable Session.

This is an internal orchestration API, not a public “find arbitrary session”
endpoint. Callers persist the deterministic acquisition tag before calling it,
which closes the crash window between Session creation and caller-journal
writeback.

- [ ] **Step 4: Invoke the admission callback at the hard boundary**

Call `onAccepted` only after invocation admission/lifecycle identity is durable
and before profile preparation, attachment decoding or model/provider execution.
Pass the exact accepted `invocationId` and required prompt `clientMessageId`.

If the hook fails, use the existing invocation failure exit; do not leave an
accepted invocation looking runnable.

Immediately after the existing Session admission mutation commits **and
releases its Session lock**, the Harness persists a random execution owner,
monotonically advanced fence, and short renewable lease. It must not acquire the
execution-sidecar lock from inside `admitInvocationLocked()`, because every
cross-store path uses the opposite lock order below. `onAccepted` runs only
after the live execution record exists **and** the Harness has appended an
internal `execution_lease_established` marker to that invocation's Session
under the still-held execution lock. The marker contains only invocation
identity and fence, not a renewable deadline or credential. A crash between
Session admission and that marker is deliberately read as a
provider-not-started orphan; it cannot continue or call the Provider. If record
or marker creation fails, keep the execution lock while committing a Session
error through the same sidecar-to-Session order, or leave the durable active
lifecycle to be fenced as orphaned—never continue without a lease.

For a hooked call, perform a sidecar bootstrap/health preflight before entering
Session admission, while holding no Session lock. Release that lock, perform
admission, then reacquire and revalidate sidecar health before creating the
record/marker. The first check avoids admitting known-bad storage; the second
closes corruption races. It is intentionally not one long lock across admission,
which would invert the fixed lock order.

Immediately before any model/provider call the Harness CAS-records
`providerStartedAt` with that owner/fence; a stale owner cannot start the
Provider. Heartbeat renewal continues until a durable terminal lifecycle is
written. These Harness execution fields are distinct from any caller repository
claim and are never exposed in public Session DTOs.

Implement this in one general
`HarnessInvocationExecutionLeaseStore`, persisted at
`<Workspace Root>/.nbook/agent/invocation-execution.json`. Its strict v1 records
contain only Session/invocation/client-message identity, random owner ID, fence,
`live|orphaned` state, lease deadline, and provider-start marker. Guard
read-modify-write with `proper-lockfile` on a stable sibling
`invocation-execution.lock-target/` directory (never the JSON file that is
replaced),
publish through temp + fsync + rename, and inject clock, owner ID and lease
duration in tests. Create/verify the lock target before admission; a missing or
replaced JSON file is data evidence, not a reason to lose mutual exclusion.
On first initialization, create the stable lock-target directory, acquire it,
publish an empty strict v1 store, then fsync an `initialized` sentinel inside
the target before accepting any hooked invocation. Absence of the sentinel
means bootstrap never admitted work and may be completed/repeated; once it
exists, a missing, malformed, or version-unknown JSON store is
`execution_evidence_lost`: never recreate, overwrite, or quarantine it
automatically; never admit a new hooked invocation; and never call a Provider.

Freeze one composite terminal boundary:
`withLiveExecutionFence({sessionId, invocationId, ownerId, fence}, commit)`.
It acquires the execution-sidecar lock, revalidates the exact live,
unexpired owner/fence, invokes `commit` to append the Session terminal lifecycle
under the existing per-Session mutation lock, then prunes the sidecar record
before releasing the execution lock. The global lock order is always
**execution sidecar -> Session mutation**; no code may acquire the execution
sidecar while already holding a Session mutation lock. Every terminal exit for
an execution-leased invocation—including `onAccepted` failure, normal
completion, waiting, abort, and error—uses this composite boundary. Ordinary
invocations without an execution lease keep the existing terminal path.

Orphan detection takes the same execution lock. It first reads Session truth:
a terminal Session lifecycle wins and causes a parseable stale sidecar record
to be pruned (an unreadable global store is left untouched and reported).
Otherwise an expired live record is atomically fenced as `orphaned` with its
exact Provider-start boolean. Missing sidecar evidence plus no Session
`execution_lease_established` marker proves the admission gap and returns
`providerStartRecorded: false`; missing/corrupt/unknown evidence after that
marker returns `providerStartRecorded: null` and is never rewritten as a clean
record. If orphan fencing wins first, the old owner's later composite terminal
commit fails before it can mutate Session. If Session terminal commit wins
first, orphan detection blocks until it can observe that terminal truth. A
process crash after Session terminal append but before sidecar pruning is
recovered by the same terminal-wins read path. This cross-store critical section
is what makes late terminal writes fail; a detached sidecar CAS followed by a
separate Session append is forbidden.

- [ ] **Step 5: Read the durable result from session truth**

Implement `readDurableInvocationResult()` by reading the durable session active
path and locating the user entry bound to `clientMessageId`, its invocation
lifecycle and the corresponding `report_result`. Do not use the bounded public
DTO or an in-memory invocation map.

Return `completed` only when the invocation has a successful terminal lifecycle
and a full structured `report_result.data`. Return
`completed_without_result` for a successful final assistant message without the
tool result; do not make background workflows poll it forever. Preserve
`waiting` and failed lifecycle states so callers can make their own explicit
retry policy.

Return `active` only while the durable Harness execution lease is unexpired.
Once it expires, atomically fence the abandoned execution and return
`orphaned`; no reconstructed Harness may resume or invoke that same
`clientMessageId`. `providerStartRecorded: null` means the durable
lease-established marker survived but its sidecar evidence did not; callers
must treat it at least as conservatively as `true`.
`providerStartRecorded` is ambiguity evidence, not permission to retry. Tests
use an injected clock/lease duration—never wall-clock sleeps.

- [ ] **Step 6: Run focused and Agent regression tests**

Run:

```powershell
bunx vitest run server/agent/harness/invocation-execution-lease.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/profiles/report-result-schema.test.ts
```

Expected: both files PASS; the restart case in the Harness suite reads the same
structured data without invoking a model.

- [ ] **Step 7: Commit the general Harness seams**

```powershell
git add server/agent/harness/types.ts server/agent/harness/neuro-agent-harness.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/harness/invocation-execution-lease.ts server/agent/harness/invocation-execution-lease.test.ts
git commit -m "feat(agent): expose durable invocation admission results"
```

---

### Task 2: Define the direct contract, browser-safe hash and Director operation

**Files:**

- Create: `shared/text-to-image-file-hash.ts`
- Create: `shared/text-to-image-file-hash.test.ts`
- Create: `shared/text-to-image-character-direct-write.ts`
- Create: `shared/text-to-image-character-direct-write.test.ts`
- Modify: `shared/text-to-image-character-visual.ts`
- Modify: `shared/text-to-image-character-visual.test.ts`
- Modify: `server/text-to-image/strict-frontmatter.ts`
- Modify: `shared/agent/illustration-director.ts`
- Modify: `assets/workspace/.nbook/agent/profiles/builtin/illustration.director.profile.tsx`
- Modify: `server/agent/profiles/illustration-director-assets.test.ts`

**Interfaces:**

```ts
export const CharacterVisualDirectWriteRequestSchema = z.object({
    projectPath: z.string().trim().min(1).max(500),
    characterPath: z.string()
        .regex(/^lorebook\/character\/[^/\\]+\/index\.md$/u)
        .max(500),
    sourceCharacterFileHash: TextToImageContractHashSchema,
    idempotencyKey: z.string().uuid(),
}).strict();

export const CharacterVisualDirectorOutputSchema = z.object({
    schemaVersion: z.literal("nbook.character-visual-director-output/v2"),
    operation: z.literal("generate-character-visual"),
    state: z.enum(["completed", "blocked"]),
    sourceCharacterFileHash: TextToImageContractHashSchema,
    summary: z.string().trim().min(1).max(2000),
    character: CharacterVisualRawDraftSchema.nullable(),
    outfits: z.array(OutfitVisualRawDraftSchema).max(64),
    diagnostics: z.array(CharacterVisualDirectorDiagnosticSchema).max(256),
}).strict();
```

The HTTP result is completed-only:

```ts
{
    state: "completed";
    operationId: string;
    sessionId: number;
    invocationId: string;
    characterImageTagsPath: string;
    outfitPaths: string[];
    diagnostics: Array<{
        code: "TAG_REVIEW_EXCLUDED";
        owner: string;
        field: string;
        sourceText: string;
        message: string;
    }>;
    fileHashes: Record<string, string>;
}
```

Freeze every direct-write error code and the exact terminal subset in the same
shared contract:

```ts
export const CHARACTER_VISUAL_OPERATION_RUNNING_CODE =
    "CHARACTER_VISUAL_OPERATION_RUNNING" as const;

export const CHARACTER_VISUAL_DIRECT_WRITE_TERMINAL_ERROR_CODES = [
    "ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED",
    "CHARACTER_VISUAL_SOURCE_STALE",
    "CHARACTER_VISUAL_TARGET_STALE",
    "CHARACTER_VISUAL_DIRECTOR_FAILED",
    "CHARACTER_VISUAL_DURABLE_INVOCATION_MISSING",
    "CHARACTER_VISUAL_INVOCATION_ORPHANED",
    "CHARACTER_VISUAL_DIRECTOR_OUTPUT_INVALID",
    "CHARACTER_VISUAL_POLICY_BLOCKED",
    "CHARACTER_VISUAL_OUTFIT_NAME_INVALID",
    "CHARACTER_VISUAL_OUTFIT_CONFLICT",
    "CHARACTER_VISUAL_OPERATION_CONFLICT",
] as const;

export const CharacterVisualDirectWriteTerminalErrorCodeSchema =
    z.enum(CHARACTER_VISUAL_DIRECT_WRITE_TERMINAL_ERROR_CODES);

export const CharacterVisualDirectWriteErrorCodeSchema = z.union([
    CharacterVisualDirectWriteTerminalErrorCodeSchema,
    z.literal(CHARACTER_VISUAL_OPERATION_RUNNING_CODE),
]);
```

`CHARACTER_VISUAL_OPERATION_RUNNING` is deliberately absent from the terminal
subset because it proves the opposite. Unknown/auth/Project/5xx codes are not
terminal evidence for the client-side idempotency key and therefore fail closed
by retaining it.

- [ ] **Step 1: Add failing shared-contract tests**

Cover:

- UTF-8 hash parity in browser/server runtimes, including Chinese and CRLF;
- request rejects non-UUID keys, non-character paths and invalid hashes;
- blocked Director output cannot contain character/outfits;
- completed output requires a character;
- every outfit field is present;
- each raw field contains at most 20 comma-delimited, trimmed non-empty tags;
- exported `VisualStableIdSchema` accepts valid Chinese/ASCII stable IDs and
  rejects path/control syntax;
- the terminal-error schema contains every stable direct-write terminal code
  and rejects `CHARACTER_VISUAL_OPERATION_RUNNING` plus unrelated API codes.

- [ ] **Step 2: Run shared tests and confirm RED**

Run:

```powershell
bunx vitest run shared/text-to-image-file-hash.test.ts shared/text-to-image-character-direct-write.test.ts shared/text-to-image-character-visual.test.ts server/agent/profiles/illustration-director-assets.test.ts
```

Expected: FAIL on absent contracts and old `propose-character-visual` Profile.

- [ ] **Step 3: Add one cross-runtime UTF-8 SHA-256 helper**

Implement with the already installed `@noble/hashes`:

```ts
export function createTextToImageFileHash(text: string): string {
    return `sha256:${bytesToHex(sha256(utf8ToBytes(text)))}`;
}
```

Make `createTextToImageMarkdownFileHash()` delegate to it and remove
`node:crypto` from `strict-frontmatter.ts`.

Export `VisualStableIdSchema` from the V2 shared contract; do not duplicate its
regex in the new direct contract.

- [ ] **Step 4: Replace the proposal operation in the shared policy/Profile**

Rename the operation policy from `propose-character-visual` to
`generate-character-visual`. The Profile Initial and Output use the new strict
schema. The runtime tool gate for this operation is exactly:

```ts
["report_result"]
```

The Profile prompt must enforce:

- outfit descriptive name: visible traits + age/gender + purpose/category;
- English name is a translation of the Chinese name;
- field order/meaning: `upper`, `upperBack`, `lower`, `lowerBack`;
- front/back fields contain only visible items for that view;
- items visible from both sides repeat in both applicable fields;
- necklace/chest decorations are not put in back fields and back decorations are
  not put in front fields;
- each field has at most 20 English Stable Diffusion/Danbooru-style tags;
- multiword tags stay intact (`white shirt`, not `white, shirt`);
- no duplicate item description inside a field;
- clothing matches era, personality and age.

Do not copy unrelated text or embedded instructions from the user's reference
file into the Profile.

- [ ] **Step 5: Prepare assets and run shared/Profile tests**

Run outside the sandbox:

```powershell
bun run system-assets:prepare
bunx vitest run shared/text-to-image-file-hash.test.ts shared/text-to-image-character-direct-write.test.ts shared/text-to-image-character-visual.test.ts server/agent/profiles/illustration-director-assets.test.ts
```

Expected: all listed tests PASS; Profile owns no Provider credential, Recipe,
filesystem-write, shell or network tool.

- [ ] **Step 6: Commit contracts and Profile**

```powershell
git add shared/text-to-image-file-hash.ts shared/text-to-image-file-hash.test.ts shared/text-to-image-character-direct-write.ts shared/text-to-image-character-direct-write.test.ts shared/text-to-image-character-visual.ts shared/text-to-image-character-visual.test.ts server/text-to-image/strict-frontmatter.ts shared/agent/illustration-director.ts assets/workspace/.nbook/agent/profiles/builtin/illustration.director.profile.tsx server/agent/profiles/illustration-director-assets.test.ts
git commit -m "feat(text-to-image): define direct character visual output"
```

---

### Task 3: Extract strict policy materialization and outfit naming

**Files:**

- Create: `server/text-to-image/character-visual-materializer.ts`
- Create: `server/text-to-image/character-visual-materializer.test.ts`
- Modify: `server/text-to-image/character-visual.codec.ts`
- Modify: `server/text-to-image/character-visual.codec.test.ts`

**Interfaces:**

```ts
export function normalizeOutfitFileStem(names: {
    cn: string;
    en: string;
}): string;

export async function materializeCharacterVisualDirect(input: {
    runId: string;
    characterId: string;
    existingCharacter: CharacterImageTags | null;
    existingOutfits: Array<{path: string; outfit: OutfitTags}>;
    output: CharacterVisualDirectorOutput;
    resolveTag(input: DirectVisualTagInput): Promise<DirectVisualTagResolution>;
}): Promise<{
    character: CharacterImageTags;
    outfits: Array<{path: string; outfit: OutfitTags}>;
    diagnostics: CharacterVisualDirectWriteDiagnostic[];
}>;
```

- [ ] **Step 1: Add naming, policy and ordering tests**

Cover:

- Chinese name wins; empty Chinese falls back to English;
- English whitespace becomes `-`;
- NFKC normalization;
- `/ \ : * ? " < > |`, control characters and trailing dot/space are rejected
  or removed before final schema validation;
- `CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`, including extensions and
  case variants, are rejected;
- empty result, more than 160 characters and invalid `VisualStableIdSchema`
  fail the whole materialization;
- duplicate names and two names normalizing to the same stem fail; no suffix is
  generated;
- same stem/same owner updates the file; same stem/different owner fails;
- existing valid outfits absent from the new output remain referenced unchanged;
- `allow` and permitted passthrough become terminal V2 resolutions;
- `review_required` is omitted and diagnosed without an approval;
- one `block`, unknown macro, weight, XML/Markdown or Provider parameter aborts
  every document;
- more than 20 terminal tags in any field aborts instead of truncating.

Add a codec snapshot/round-trip that locks this order:

```yaml
schema: nbook.outfit-tags/v2
outfitId: 深蓝色少女水手校服
ownerCharacterId: xiao-ming
names:
  cn: 深蓝色少女水手校服
  en: dark navy girls sailor uniform
resolutionScope: ...
fields:
  upper: ...
  upperBack: ...
  lower: ...
  lowerBack: ...
fieldProviderSyntaxRefs: ...
providerSyntaxNodes: ...
tagResolutions: ...
policyApprovals: {}
```

- [ ] **Step 2: Run materializer/codec tests and confirm RED**

Run:

```powershell
bunx vitest run server/text-to-image/character-visual-materializer.test.ts server/text-to-image/character-visual.codec.test.ts
```

Expected: FAIL because the materializer is absent and renderer order is not yet
explicitly locked.

- [ ] **Step 3: Implement deterministic normalization and collision checks**

Use POSIX Project paths:

```ts
const path = `${characterDirectory}/outfits/${stem}.md`;
const outfitRef = `outfits/${stem}.md`;
const outfitId = stem;
```

All three identities must remain equal. Sort new target paths by ASCII code-point
comparison before rendering/writing.

- [ ] **Step 4: Resolve every atomic tag under its owner/field**

Split only on commas, trim, preserve multiword atoms, reject empty/duplicate atoms,
and call `TagResolverService.resolveExplicitImportTag()` with generic NovelAI
scope and no approval.

Interpret terminal policy exactly:

- `allow`: include the terminal resolution;
- permitted `provider_passthrough`: include sanitation evidence;
- `review_required`: exclude it and append `TAG_REVIEW_EXCLUDED`;
- `block`: throw `CHARACTER_VISUAL_POLICY_BLOCKED`.

Keep `policyApprovals: {}` for all newly materialized documents.

- [ ] **Step 5: Render and parse every result before returning**

Canonicalize, render, parse, and compare all character/outfit documents. A
round-trip mismatch is an internal error before any write.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
bunx vitest run server/text-to-image/character-visual-materializer.test.ts server/text-to-image/character-visual.codec.test.ts shared/text-to-image-character-visual.test.ts
```

Expected: all listed tests PASS.

- [ ] **Step 7: Commit materialization**

```powershell
git add server/text-to-image/character-visual-materializer.ts server/text-to-image/character-visual-materializer.test.ts server/text-to-image/character-visual.codec.ts server/text-to-image/character-visual.codec.test.ts
git commit -m "feat(text-to-image): materialize strict character visual files"
```

---

### Task 4: Implement the recoverable direct-write journal and runtime

**Files:**

- Create: `server/text-to-image/character-visual-direct-write.service.ts`
- Create: `server/text-to-image/character-visual-direct-write.service.test.ts`
- Create: `server/text-to-image/character-visual-direct-write.runtime.ts`
- Create: `server/text-to-image/character-image-tags-http-error.ts`
- Rewrite: `server/text-to-image/character-image-tags.ts`
- Rewrite: `server/text-to-image/character-image-tags.test.ts`

**Interfaces:**

Journal path:

```text
.nbook/text-to-image/character-visual-direct-write/<idempotencyKey>/journal.json
```

Journal states:

```ts
"created" | "running" | "result_ready" | "prepared" |
"completed" | "blocked" | "stale" | "failed"
```

The journal freezes:

- Project/character path, source character hash, actor and operation ID;
- prior `image-tags.md` bytes/hash or null;
- prior referenced valid V2 outfit bytes/hashes;
- every new same-name target's prior bytes/hash or null;
- stable Session acquisition tag, `clientMessageId`, and Agent
  session/invocation identity;
- strict Director result/hash;
- rendered target bytes/hashes and per-write state;
- final diagnostics/result.

- [ ] **Step 1: Add failing state-machine and crash-window tests**

Use an in-memory store plus fake Harness/Resolver. Cover:

1. first request creates the journal before Director execution;
2. crash after durable Session creation but before journal Session-ID writeback
   reacquires that Session rather than creating another;
3. `onAccepted` persists session/invocation before fake Provider start;
4. crash after Harness durable admission but before journal admission writeback
   is recovered by reading the tagged Session/client message before any invoke;
5. `onAccepted` journal failure seals the durable invocation and restart never
   invokes that client message again;
6. duplicate request while running bounded-waits the same durable operation;
   completion within the request budget returns that result, while a still-live
   operation returns `CHARACTER_VISUAL_OPERATION_RUNNING` without changing the
   journal or idempotency identity;
7. restart with durable `report_result` resumes without another invoke;
8. after hard reconstruction an initially live `active` result is re-read until
   either completion or its lease expires; expiry becomes `orphaned` and cannot
   remain falsely running forever;
9. durable `missing` after recorded journal admission, `orphaned`, waiting,
   failed, or completed-without-result becomes one stable operation
   failure rather than polling or invoking again;
10. completed replay returns byte-identical result;
11. same key with different Project/path/source hash conflicts;
12. source `index.md` changing during Director makes the journal stale;
13. target changing before prepare makes the journal stale;
14. outfits write in stable path order and `image-tags.md` writes last;
15. crash after any outfit resumes when bytes equal target;
16. bytes equal neither source nor target make recovery stale;
17. crash before `image-tags.md` can leave an unreferenced new outfit but never a
    missing outfit reference;
18. blocked output/policy writes no target file;
19. valid unreturned outfits remain byte-identical and referenced.

- [ ] **Step 2: Run service tests and confirm RED**

Run:

```powershell
bunx vitest run server/text-to-image/character-visual-direct-write.service.test.ts server/text-to-image/character-image-tags.test.ts
```

Expected: FAIL because the direct service/runtime do not exist.

- [ ] **Step 3: Implement Project locking and immutable journal transitions**

Use a per-Project/per-character lock for in-process serialization and CAS every
journal/target write against the recorded prior bytes. The service sequence is:

1. validate request and character directory identity;
2. freeze source/current V2 targets plus a deterministic Session acquisition tag
   in `created`;
3. acquire-or-reuse the Agent Session by that tag and persist its ID;
4. call `readDurableInvocationResult({sessionId,clientMessageId})` before every
   possible invoke;
5. invoke only for durable `missing` with no journal admission, using the stable
   `clientMessageId`, explicit `queueIfBusy: false`, and persisting admission
   through `onAccepted`;
6. for live `active`, release every Project/filesystem lock and re-read durable
   state on an injected 250 ms interval for at most a fixed 30-second HTTP
   request budget; honor each refreshed `executionLeaseUntil`, but never extend
   the fixed request budget. Completion continues this same operation, lease
   expiry is observed as `orphaned`, and a still-live invocation at the budget
   boundary throws `CHARACTER_VISUAL_OPERATION_RUNNING` without terminalizing
   the journal;
7. map
   orphaned/waiting/failed/completed-without-result to stable failure, map
   `missing` after journal admission to
   `CHARACTER_VISUAL_DURABLE_INVOCATION_MISSING`, or recover/strict-parse a
   completed result into `result_ready`;
8. revalidate source and all target snapshots;
9. resolve/materialize/render/round-trip and persist `prepared`;
10. write sorted outfits;
11. write `image-tags.md` last;
12. persist `completed`.

Never hold a filesystem/Project lock during model inference; reacquire it for
every journal transition and revalidate frozen hashes.
Harness admission is durable before `onAccepted`, so Project/journal admission
fields are not the authority for whether an invocation already exists. The
pre-invoke durable read is mandatory after Session reacquisition and closes that
crash window. If two same-operation requests both observe `missing` and one
loses the Harness busy/admission race, the loser must immediately re-read the
same Session/client message and enter the active/completed reconciliation path;
it must not mark the shared journal failed or create a follow-up.

- [ ] **Step 4: Wire the production runtime**

The runtime:

- resolves the active Project root and asserts it is open;
- reads `index.md`, `image-tags.md` and referenced valid V2 outfits;
- loads Project Tag Policy and active Tag index;
- creates the one `illustration.director` session;
- invokes `generate-character-visual` with `report_result` only;
- uses tracked Project writes and invalidates the workspace tree after completion.

It must not depend on a migration/proposal service.

- [ ] **Step 5: Replace the public orchestration function and error mapper**

`character-image-tags.ts` should export only the direct request schema,
`generateCharacterVisualFiles()`, and errors typed/validated by the shared
`CharacterVisualDirectWriteErrorCodeSchema`; do not duplicate string unions in
the server. The frozen codes are:

```text
ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED
CHARACTER_VISUAL_SOURCE_STALE
CHARACTER_VISUAL_TARGET_STALE
CHARACTER_VISUAL_DIRECTOR_FAILED
CHARACTER_VISUAL_DURABLE_INVOCATION_MISSING
CHARACTER_VISUAL_INVOCATION_ORPHANED
CHARACTER_VISUAL_OPERATION_RUNNING
CHARACTER_VISUAL_DIRECTOR_OUTPUT_INVALID
CHARACTER_VISUAL_POLICY_BLOCKED
CHARACTER_VISUAL_OUTFIT_NAME_INVALID
CHARACTER_VISUAL_OUTFIT_CONFLICT
CHARACTER_VISUAL_OPERATION_CONFLICT
```

Map validation/policy/conflict/in-progress errors to `409`, malformed requests
to `400`, and unexpected failures to the existing safe HTTP error pattern.

- [ ] **Step 6: Run direct service/runtime tests**

Run:

```powershell
bunx vitest run server/text-to-image/character-visual-direct-write.service.test.ts server/text-to-image/character-image-tags.test.ts server/agent/harness/neuro-agent-harness.test.ts
```

Expected: all listed tests PASS and the fake invocation count remains one across
response loss/restart.

- [ ] **Step 7: Commit the direct runtime**

```powershell
git add server/text-to-image/character-visual-direct-write.service.ts server/text-to-image/character-visual-direct-write.service.test.ts server/text-to-image/character-visual-direct-write.runtime.ts server/text-to-image/character-image-tags-http-error.ts server/text-to-image/character-image-tags.ts server/text-to-image/character-image-tags.test.ts
git commit -m "feat(text-to-image): write character visuals directly"
```

---

### Task 5: Replace the API and character-detail UI with one direct action

**Files:**

- Modify: `server/api/text-to-image/character-image-tags.post.ts`
- Create: `server/api/text-to-image/character-image-tags-api-contract.test.ts`
- Create: `app/utils/character-visual-direct-write-pending.ts`
- Create: `app/utils/character-visual-direct-write-pending.test.ts`
- Modify: `app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue`
- Create: `server/text-to-image/character-direct-write-ui-contract.test.ts`
- Modify: `server/text-to-image/character-visual-registry.service.ts`
- Modify: `server/text-to-image/character-visual-registry.service.test.ts`

- [ ] **Step 1: Add failing API/UI ownership tests**

Assert the route:

- authenticates;
- validates `sourceCharacterFileHash` and UUID `idempotencyKey`;
- uses the direct error mapper;
- returns `CharacterVisualDirectWriteResultSchema` only for completion;
- maps a durable operation that is still live after the bounded wait to the
  stable in-progress error while leaving the same key retryable by the client;
- after Harness reconstruction, observes `active` first and then the fake-clock
  lease expiry as an orphaned terminal failure instead of hanging the request;
- the pending-operation codec stores only a version, source hash and UUID in
  `localStorage` under a SHA-256 scope key—never raw Project or character
  paths—and rejects malformed entries;
- clearing is compare-and-delete by idempotency key, so a late response from an
  older request cannot erase a newer pending identity; a changed saved-source
  hash atomically replaces the old pending key before its request;
- reload/navigation/browser restart and a network/unknown-API/in-progress
  response retain the same key for the same saved source; success or a code in
  the shared terminal-error schema removes it, so a later explicit generation
  receives a new key.

Assert the character panel:

- saves the current `index.md` first;
- hashes the saved UTF-8 text with the shared helper;
- creates/retains a UUID for request retry;
- calls only `/api/text-to-image/character-image-tags`;
- shows progress/success/error notification;
- refreshes the current workspace tree/file after success;
- contains no preview, merge decision, proposal or migration state.

- [ ] **Step 2: Run contract tests and confirm RED**

Run:

```powershell
bunx vitest run server/api/text-to-image/character-image-tags-api-contract.test.ts app/utils/character-visual-direct-write-pending.test.ts server/text-to-image/character-direct-write-ui-contract.test.ts server/text-to-image/character-visual-registry.service.test.ts
```

Expected: FAIL on the old proposal response and UI.

- [ ] **Step 3: Implement the strict route**

Use the existing auth, body validation and Project-open guard. The handler calls
`generateCharacterVisualFiles()` and parses its result before returning.

- [ ] **Step 4: Simplify the character panel**

Delete:

- `directorPreview`;
- conflict decisions/computed state;
- `prepareDirectorMigration()`;
- field-label helper;
- preview/diff/radio/apply template.

Persist the pending identity before `$fetch` through the tested
`localStorage` codec. The storage key is the hash of the operation scope
(`projectPath + NUL + characterPath`), while the stored value contains no raw
path. The action body is equivalent to:

```ts
await saveDraft();
const sourceCharacterFileHash = createTextToImageFileHash(selectedFileContent.value);
const pending = readPendingDirectWrite({projectPath, characterPath});
const idempotencyKey = pending?.sourceCharacterFileHash === sourceCharacterFileHash
    ? pending.idempotencyKey
    : crypto.randomUUID();
writePendingDirectWrite({projectPath, characterPath, idempotencyKey, sourceCharacterFileHash});
try {
    const result = CharacterVisualDirectWriteResultSchema.parse(await $fetch(...));
    clearPendingDirectWrite({projectPath, characterPath, idempotencyKey});
    return result;
} catch (error) {
    const code = resolveApiErrorCode(error);
    if (CharacterVisualDirectWriteTerminalErrorCodeSchema.safeParse(code).success) {
        clearPendingDirectWrite({projectPath, characterPath, idempotencyKey});
    }
    throw error;
}
```

Keep the same key for a transport/unknown-server retry or a confirmed still-live
operation of the same saved source. A completed or shared-schema-proven terminal
operation clears it, so the next explicit generation gets a new key. Never expire a
pending identity by local wall-clock age: replay it and let the server's durable
journal decide, rather than silently turning an uncertain invocation into a
second Director call.

- [ ] **Step 5: Make registry semantics V2-only without migration hints**

Registry reads valid V2 files, reports invalid V2 as an error, and treats
missing/old files as absent visual data. Remove any error wording or branch that
directs the user to migration UI.

- [ ] **Step 6: Run API/UI/registry tests**

Run:

```powershell
bunx vitest run server/api/text-to-image/character-image-tags-api-contract.test.ts app/utils/character-visual-direct-write-pending.test.ts server/text-to-image/character-direct-write-ui-contract.test.ts server/text-to-image/character-visual-registry.service.test.ts
```

Expected: all listed tests PASS.

- [ ] **Step 7: Commit the direct user path**

```powershell
git add server/api/text-to-image/character-image-tags.post.ts server/api/text-to-image/character-image-tags-api-contract.test.ts app/utils/character-visual-direct-write-pending.ts app/utils/character-visual-direct-write-pending.test.ts app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue server/text-to-image/character-direct-write-ui-contract.test.ts server/text-to-image/character-visual-registry.service.ts server/text-to-image/character-visual-registry.service.test.ts
git commit -m "feat(text-to-image): make character tag generation reviewless"
```

---

### Task 6: Delete the migration/source/proposal control plane

**Files:**

- Delete: `shared/text-to-image-character-migration.ts`
- Delete: `shared/text-to-image-character-source.ts`
- Delete: `server/text-to-image/character-visual-migration.ts`
- Delete: `server/text-to-image/character-visual-migration.test.ts`
- Delete: `server/text-to-image/character-visual-migration.service.ts`
- Delete: `server/text-to-image/character-visual-migration.service.test.ts`
- Delete: `server/text-to-image/character-visual-migration.runtime.ts`
- Delete: `server/text-to-image/character-visual-migration-http-error.ts`
- Delete: `server/text-to-image/character-visual-migration-ui-contract.test.ts`
- Delete: `server/text-to-image/ttp-character-visual-source.ts`
- Delete: `server/text-to-image/ttp-character-visual-source.test.ts`
- Delete: `server/api/text-to-image/character-visual-migrations/**`
- Delete: `app/components/novel-ide/text-to-image/TextToImageCharacterMigrationPanel.vue`
- Delete: `app/components/novel-ide/text-to-image/TextToImageCharacterSourcePanel.vue`
- Delete: `app/utils/text-to-image-character-tags.ts`
- Delete: `app/utils/text-to-image-character-tags.test.ts`
- Delete: `app/utils/text-to-image-outfit-tags.ts`
- Delete: `app/utils/text-to-image-outfit-tags.test.ts`
- Delete: `app/utils/text-to-image-outfit-design.ts`
- Delete: `app/utils/text-to-image-outfit-design.test.ts`
- Modify: `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`
- Create: `server/text-to-image/character-visual-old-chain-removal.test.ts`

- [ ] **Step 1: Add a failing old-chain ownership gate**

Assert every deleted path is absent and scan production sources for:

```text
character-visual-migrations
CharacterVisualMigration
CharacterVisualDirectorPreview
CharacterVisualMergeDecision
proposal_ready
director-prepare
source-preview
source-prepare
propose-character-visual
character-visual-proposals
```

Exclude docs and tests from token scans. Do not ban `policyApprovals`, V2 schema
names, registry or direct-write journal paths.

- [ ] **Step 2: Run the gate and confirm RED**

Run:

```powershell
bunx vitest run server/text-to-image/character-visual-old-chain-removal.test.ts
```

Expected: FAIL and enumerate current owners.

- [ ] **Step 3: Remove the files and final panel mount**

Delete the listed control-plane files and the migration component import/render
from `NovelTextToImagePanel.vue`. Keep the Workflow and global Storyboard import
panels.

Do not delete historical
`.nbook/text-to-image/character-visual-migrations/**` or
`.nbook/text-to-image/character-visual-proposals/**` from user Projects.

- [ ] **Step 4: Run removal, Profile, registry and direct-path tests**

Run:

```powershell
bun run system-assets:prepare
bunx vitest run server/text-to-image/character-visual-old-chain-removal.test.ts server/text-to-image/character-visual-direct-write.service.test.ts server/text-to-image/character-image-tags.test.ts server/api/text-to-image/character-image-tags-api-contract.test.ts server/text-to-image/character-direct-write-ui-contract.test.ts server/text-to-image/character-visual-registry.service.test.ts server/text-to-image/character-visual.codec.test.ts server/agent/profiles/illustration-director-assets.test.ts
```

Expected: all listed tests PASS.

- [ ] **Step 5: Commit old-chain removal**

Stage the listed deletions and `NovelTextToImagePanel.vue`, then commit:

```powershell
git commit -m "refactor(text-to-image): remove character visual migration"
```

---

### Task 7: Verify the complete character direct-write slice

- [ ] **Step 1: Run the focused subsystem suite**

Run:

```powershell
bunx vitest run shared/text-to-image-file-hash.test.ts shared/text-to-image-character-direct-write.test.ts shared/text-to-image-character-visual.test.ts server/text-to-image/character-visual-materializer.test.ts server/text-to-image/character-visual.codec.test.ts server/text-to-image/character-visual-registry.service.test.ts server/text-to-image/character-visual-direct-write.service.test.ts server/text-to-image/character-image-tags.test.ts server/api/text-to-image/character-image-tags-api-contract.test.ts server/text-to-image/character-direct-write-ui-contract.test.ts server/text-to-image/character-visual-old-chain-removal.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/profiles/illustration-director-assets.test.ts
```

Expected: all listed tests PASS.

- [ ] **Step 2: Run type checking**

Run outside the sandbox:

```powershell
bun run typecheck
```

Expected: no new diagnostics in modified files; record any documented vendored
baseline exactly.

- [ ] **Step 3: Run final ownership scans**

Run:

```powershell
rg -n "character-visual-migrations|CharacterVisualMigration|proposal_ready|director-prepare|propose-character-visual" app shared server --glob "!**/*.test.ts"
```

Expected: no matches.

Run:

```powershell
rg -n "generate-character-visual|character-visual-direct-write|image-tags\\.md|OUTFIT_TAG_FIELDS" app shared server assets/workspace/.nbook/agent/profiles/builtin/illustration.director.profile.tsx
```

Expected: only the new operation, journal, stable filename and retained V2 owners
appear.
