# Text-to-Image P5 Reference Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete P5 as one strict production path: a single NovelAI capability registry, content-addressed Project reference assets, dual-image Inpaint, verified Vibe import/cache lineage, paid-window byte resolution, generated-asset promotion, and reference-safe deletion.

**Architecture:** Freeze every reference fact before authorization, but defer all byte reads and Base64 conversion until the persistent provider attempt has started. Source images, Vibe encodings, imports, and promotions use typed Project SQLite records plus content-addressed files under `.nbook/text-to-image/references`; one Project-scoped cross-process mutation lock serializes file/DB pairs and reference-owner changes. The compiler consumes only verified metadata and the adapter consumes only the frozen discriminated request plus a byte resolver.

**Tech Stack:** TypeScript, Zod, Prisma 7 Project SQLite, Nuxt/H3, Vue 3, Pinia, `proper-lockfile`, `sharp`, Vitest, Bun, NovelAI Image API.

## Global Constraints

- Execute after `2026-07-27-character-visual-direct-generation.md` and before the P6 candidate-review plan.
- Extend only `shared/text-to-image-provider-registry.ts`; do not introduce another model/cost/action map.
- Export the registry's existing V4-family predicate/capability as the only
  model-family authority. The adapter and Settings panel must consume it; they
  must not retain private regex or model-ID substring branches.
- Keep Recipe schema version `3`. This is a hard contract cut, not a Recipe version downgrade or compatibility reader.
- Bump every changed persisted/signed contract; Recipe v3 is the only changed
  slice that intentionally retains its version. P5 freezes:
  `provider-grammar-registry/v2`, capability snapshot v3, grammar/capability
  registry versions v3, CompiledRequest v2, execution input v2, Manifest v2,
  Approval v2, Preview v2, and dispatch registration v3. Old literals must fail
  strict parsing rather than share a version with the new shape.
- Support Inpaint initially only where the registry has an evidence-backed generate-model to wire-model mapping. The first required mapping is `nai-diffusion-4-5-full -> nai-diffusion-4-5-full-inpainting` with action `infill`; every other unmapped model fails closed.
- Do not accept WebP as an Inpaint base or mask. Do not transcode masks.
- Never persist or return raw bytes, Base64, Data URLs, absolute paths, credentials, or vendor IDs in Recipe, CompiledRequest, Manifest, Job, outbox, or public DTOs.
- Keep the existing manual queue for plain prompt generation, but make it
  explicitly reference-free. `compileManual()` fails with
  `TEXT_TO_IMAGE_MANUAL_REFERENCES_UNSUPPORTED` when the saved Recipe has any
  Vibe, Precise, or Inpaint selection; it must never silently ignore references
  or grow a second reference payload builder.
- Keep the private sample `C:\Users\admir\Downloads\6f233a-d45ae0.naiv4vibe` outside the repository and outside test output. Committed tests use deterministic synthetic containers.
- Do not inspect a signed-in browser session, automate NovelAI, or make a paid request. Wire checks use pure projections, recorded response-shaped fixtures, and the official API schema.
- Install `sharp@latest` with Bun outside the sandbox, then verify Nitro/Product staging includes its native runtime.
- Run every `bun`/`bunx` command in this plan outside the sandbox, per repository
  policy.

The exact P5 version literals are:

| Constant | Literal |
|---|---|
| `PROVIDER_GRAMMAR_REGISTRY_SCHEMA_VERSION` | `nbook.provider-grammar-registry/v2` |
| `PROVIDER_CAPABILITY_SNAPSHOT_SCHEMA_VERSION` | `nbook.provider-capability-snapshot/v3` |
| `PROVIDER_GRAMMAR_REGISTRY_VERSION` | `nbook-novelai-provider-grammar-v3` |
| `PROVIDER_CAPABILITY_REGISTRY_VERSION` | `nbook-generic-novelai-capability-v3` |
| `ILLUSTRATION_COMPILED_REQUEST_SCHEMA_VERSION` | `nbook.illustration-compiled-request/v2` |
| `ILLUSTRATION_EXECUTION_INPUT_SCHEMA_VERSION` | `nbook.illustration-execution-input/v2` |
| `ILLUSTRATION_EXECUTION_MANIFEST_SCHEMA_VERSION` | `nbook.illustration-execution-manifest/v2` |
| `ILLUSTRATION_EXECUTION_APPROVAL_SCHEMA_VERSION` | `nbook.illustration-execution-approval/v2` |
| `ILLUSTRATION_EXECUTION_PREVIEW_VERSION` | `nbook.illustration-execution-preview/v2` |
| `ILLUSTRATION_DISPATCH_REGISTRATION_VERSION` | `route-b-dispatch-registration-v3` |
- Use the existing `proper-lockfile` dependency. Do not nest the new reference mutation lock; expose locked public methods and transaction-aware internal primitives instead.
- Project SQLite is initialized/upgraded by `server/workspace-files/project-workspace.ts`, not by the App SQLite migration directory. Every schema change must update the Prisma Project schema, new-Project SQL, an idempotent old-Project ensure function, and real initializer tests.
- Regenerate `server/generated/project-prisma/**`; never hand-edit generated Prisma output.

## Frozen Contracts

```ts
export type TextToImageInpaintSelection = {
    baseImageContentHash: string;
    maskContentHash: string;
} | null;

export type FrozenReferenceAsset = {
    contentHash: string;
    kind: "source-image";
    mimeType: "image/png" | "image/jpeg";
    byteLength: number;
    width: number;
    height: number;
};

export type PreparedGeneratedPromotion = {
    generatedAssetId: string;
    generatedAssetContentHash: string;
    reference: FrozenReferenceAsset;
};
```

The compiled reference closure is:

```ts
references: {
    normalizeVibeStrengths: boolean;
    vibeReferences: Array<{
        asset: FrozenReferenceAsset;
        strength: number;
        informationExtracted: number;
        encoderVersion: "novelai-vibe/v4-5full/v1";
    }>;
    characterReferences: Array<{
        asset: FrozenReferenceAsset;
        strength: number;
    }>;
    inpaint: {
        base: FrozenReferenceAsset;
        mask: FrozenReferenceAsset & {mimeType: "image/png"};
    } | null;
    referenceSnapshotHash: string;
};
```

The request action is a discriminated union. `generate` freezes
`wireModel === model`; `infill` freezes the registered inpainting `wireModel`.
Both branches freeze `additionalCostLowerBound`, `tokenLowerBound`, and the
preflight registry/version/hash evidence.

Authorization records call the corresponding user-confirmed evidence
`acceptedAdditionalCostLowerBound` and `acceptedTokenLowerBound`. They are not
enforceable spend limits: both values are included in the approval hash and must
equal the frozen Preview lower bounds at authorization time.

`compiledRevision` is the stable semantic request hash. Its preimage contains
compiler/execution-policy versions, source, Provider/capability, model/action/wire
model, prompts, character prompts, all parameters except `seed` and `count`,
Recipe, references, and expansion. `seed`, `count`, execution nonce, indices, and
both self fields (`compiledRevision` and `compiledRequestHash`) are excluded.
Compute `compiledRevision` from that base first; then compute the full request
hash over the complete request containing the validated revision. P6 may change
seed/count while retaining this revision; every output of one P6 request still
shares one full `compiledRequestHash`.

---

### Task 1: Make the provider registry the executable capability authority

**Files:**

- Modify: `shared/text-to-image-provider-registry.ts`
- Modify: `shared/text-to-image-provider-registry.test.ts`
- Modify: `shared/text-to-image-reference-asset.ts`
- Modify: `shared/text-to-image-reference-asset.test.ts`
- Modify: `shared/text-to-image-recipe.ts`
- Modify: `server/text-to-image/recipe.codec.test.ts`
- Modify: `shared/text-to-image-execution.ts`
- Modify: `shared/text-to-image-execution.test.ts`
- Modify: `shared/text-to-image-execution-ui.ts`
- Modify: `app/utils/illustration-execution-ui.ts`

**Interfaces:**

```ts
export type NovelAiCapabilityPreflightInput = {
    model: NovelAiProviderModelId;
    smeaMode: "auto" | "off" | "on";
    smeaDyn: boolean;
    useFurryDataset: boolean;
    references: {
        vibeReferences: Array<FrozenReferenceAsset>;
        characterReferences: Array<FrozenReferenceAsset>;
        inpaint: {
            base: FrozenReferenceAsset | null;
            mask: FrozenReferenceAsset | null;
        } | null;
    };
};

export type NovelAiCapabilityPreflight = {
    requestedModel: NovelAiProviderModelId;
    effectiveModel: NovelAiProviderModelId;
    wireModel: NovelAiWireModelId;
    action: "generate" | "infill";
    additionalCostLowerBound: number;
    tokenLowerBound: number;
    capabilityVersion: string;
    registryHash: string;
};
```

- [ ] **Step 1: Write failing registry and schema tests**

Add table-driven tests proving:

- Vibe plus Precise Reference fails.
- Precise Reference on an unregistered model fails.
- V4 manual SMEA and SMEA DYN fail.
- Vibe `16` succeeds and `17` fails.
- Vibe on a model with no registered encoder-version mapping fails closed.
- Character Reference `1` succeeds and `2` fails.
- an incomplete Inpaint pair fails;
- PNG/JPEG base plus same-size PNG mask succeeds;
- WebP base, non-PNG mask, unequal dimensions, and an unmapped model fail;
- V4.5 Full Inpaint yields `wireModel: "nai-diffusion-4-5-full-inpainting"` and `action: "infill"`;
- the only Vibe container mapping is
  `{bucket:"v4-5full",model:"nai-diffusion-4-5-full",encoderVersion:"novelai-vibe/v4-5full/v1"}`,
  and it contributes to the registry version/hash;
- Precise Reference and Vibe surcharges are exposed only as
  `additionalCostLowerBound`;
- Recipe v3 accepts the dual hash pair and rejects the former single
  `TextToImageReferenceSelection`;
- the strict reference page DTO accepts only
  `{items,page,pageSize,hasMore}` and rejects a bare asset array;
- CompiledRequest accepts exactly the `generate` and `infill` branches, validates
  its self-hash, and rejects `imageDataUrl`, `vibeEncoding`, `bytes`, paths, and
  `knownCost`.
- CompiledRequest rejects every cross-field mismatch even after a caller
  recomputes its self-hash: `generate` requires
  `wireModel === effectiveModel` and null Inpaint; `infill` requires the exact
  registered inpainting wire model and a complete pair.
- `createIllustrationCompiledRevisionHash()` is stable across seed/count changes
  and changes for every other frozen semantic field; a tampered embedded
  revision fails validation without a self-referential hash.
- every changed P5 schema/version constant has the new literal above and rejects
  the corresponding P0–P4 literal.

Run:

```powershell
bunx vitest run shared/text-to-image-provider-registry.test.ts shared/text-to-image-reference-asset.test.ts shared/text-to-image-execution.test.ts server/text-to-image/recipe.codec.test.ts --maxWorkers=1
```

Expected: new tests FAIL because the current Recipe has one `inpaint` selection,
CompiledRequest only permits `generate`, and the registry lacks a wire-model map.

- [ ] **Step 2: Implement the strict shared contracts**

In `shared/text-to-image-reference-asset.ts`:

- separate `TextToImageSourceReferenceAssetDtoSchema` from the typed
  `VibeEncodingDtoSchema`;
- add width and height to source metadata;
- restrict source MIME to PNG/JPEG for reference use;
- define dual Inpaint and frozen metadata schemas;
- define `TextToImageReferenceAssetPageDtoSchema` beside the public asset DTOs;
- canonicalize `informationExtracted` through the schema before hashing;
- make the reference snapshot hash cover ordered selections and all frozen
  metadata.

In `shared/text-to-image-provider-registry.ts`:

- export narrow `NovelAiWireModelId` and
  `NovelAiVibeEncoderVersion` schemas/types from registered entries; do not pass
  model/encoder identities as free-form strings;
- add the explicit V4.5 Full inpainting wire mapping to the existing registry;
- add the typed `v4-5full` Vibe container bucket/model/encoder entry to that same
  registry and include it in registry version/hash calculation;
- export the registry-backed `isNovelAiV4Model()` helper, or an equivalent
  typed capability field, and delete duplicate model-name parsing elsewhere;
- extend the existing `NovelAiCapabilityPreflightInput` with verified reference
  evidence while retaining model, SMEA, and furry-dataset fields;
- make `preflightNovelAiCapabilities()` validate combinations and dimensions and
  return the complete frozen result;
- keep unsupported mappings fail-closed with
  `TEXT_TO_IMAGE_REFERENCE_MODEL_UNSUPPORTED`;
- retain conservative surcharge lower bounds and document their evidence.

In `shared/text-to-image-execution.ts`:

- bump `ILLUSTRATION_COMPILED_REQUEST_SCHEMA_VERSION` to v2,
  `ILLUSTRATION_EXECUTION_INPUT_SCHEMA_VERSION` to v2, and
  `ILLUSTRATION_EXECUTION_MANIFEST_SCHEMA_VERSION` to v2; extract a named
  Approval v2 constant instead of another inline literal;
- replace `action: z.literal("generate")` with a strict discriminated union;
- define a registered wire-model schema rather than a free-form string, and
  cross-refine action, effective model, wire model, and Inpaint presence through
  the registry;
- freeze `wireModel`, preflight evidence, complete reference evidence, and lower
  bounds;
- add `compiledRevision` and validate it against
  `createIllustrationCompiledRevisionHash()`;
- rename Manifest `knownCost` to `additionalCostLowerBound`;
- rename Approval `authorizedCostLimit`/`authorizedTokenLimit` to
  `acceptedAdditionalCostLowerBound`/`acceptedTokenLowerBound`, include both in
  the approval hash, and require exact equality with frozen Preview evidence;
- keep `parameters.count` at `1` in P5; P6 owns multi-output expansion.

Also bump `ILLUSTRATION_EXECUTION_PREVIEW_VERSION` to v2 and the four Provider
registry/snapshot constants to the P5 versions frozen in Global Constraints.

- [ ] **Step 3: Run the focused shared-contract suite**

Run the Step 1 command again.

Expected: PASS.

- [ ] **Step 4: Commit the contract slice**

Suggested commit:

```text
feat(text-to-image): freeze strict P5 reference contracts
```

---

### Task 2: Build a verified content-addressed Project reference store

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `prisma/project.schema.prisma`
- Modify (generated): `server/generated/project-prisma/**`
- Modify: `server/workspace-files/project-workspace.ts`
- Modify: `server/workspace-files/project-workspace.test.ts`
- Modify: `server/text-to-image/asset-path.ts`
- Modify: `server/text-to-image/asset-path.test.ts`
- Create: `server/text-to-image/reference-image.ts`
- Create: `server/text-to-image/reference-image.test.ts`
- Create: `server/text-to-image/reference-asset-lock.ts`
- Create: `server/text-to-image/reference-asset-lock.test.ts`
- Rewrite: `server/text-to-image/reference-asset.service.ts`
- Rewrite: `server/text-to-image/reference-asset.service.test.ts`
- Create: `server/text-to-image/reference-asset-http-error.ts`
- Create: `server/text-to-image/reference-asset-http-error.test.ts`
- Create: `server/utils/bounded-file-multipart.ts`
- Create: `server/utils/bounded-file-multipart.test.ts`
- Modify: `server/api/agent/sessions/[sessionId]/attachments.post.ts`
- Modify: `server/api/agent/sessions/[sessionId]/attachments.post.test.ts`
- Modify: `server/api/text-to-image/reference-assets/index.post.ts`
- Create: `server/api/text-to-image/reference-assets/index.post.test.ts`
- Create: `server/api/text-to-image/reference-assets/reference-asset-api-contract.test.ts`
- Modify: `server/api/text-to-image/reference-assets/index.get.ts`
- Modify: `server/api/text-to-image/reference-assets/[id].get.ts`
- Modify: `server/api/text-to-image/reference-assets/[id].content.get.ts`
- Modify: `server/api/text-to-image/reference-assets/[id].delete.ts`

**Storage models:**

```prisma
model TextToImageReferenceAsset {
  id           String   @id
  contentHash  String   @unique
  relativePath String   @unique
  fileName     String
  mimeType     String
  byteLength   Int
  width        Int
  height       Int
  createdAt    DateTime @default(now())
  vibeEncodings TextToImageVibeEncoding[]
  promotions    TextToImageReferencePromotion[]
}

model TextToImageVibeEncodingBlob {
  id           String   @id
  contentHash  String   @unique
  relativePath String   @unique
  byteLength   Int
  createdAt    DateTime @default(now())
  lineages     TextToImageVibeEncoding[]
}

model TextToImageVibeEncoding {
  id                         String   @id
  sourceContentHash          String
  providerKind               String
  providerModel              String
  informationExtracted       Float
  canonicalInformation       String
  encoderVersion             String
  encodingContentHash        String
  provenance                 String
  importContainerContentHash String?
  createdAt                  DateTime @default(now())
  source                     TextToImageReferenceAsset    @relation(fields: [sourceContentHash], references: [contentHash], onDelete: Restrict)
  blob                       TextToImageVibeEncodingBlob   @relation(fields: [encodingContentHash], references: [contentHash], onDelete: Restrict)

  @@unique([sourceContentHash, providerModel, canonicalInformation, encoderVersion])
  @@index([encodingContentHash])
}

model TextToImageReferencePromotion {
  id                        String   @id
  generatedAssetId          String   @unique
  generatedAssetContentHash String
  referenceContentHash      String
  sourceKind                String
  sourceId                  String
  createdAt                 DateTime @default(now())
  generatedAsset            TextToImageAsset          @relation(fields: [generatedAssetId], references: [id], onDelete: Restrict)
  reference                 TextToImageReferenceAsset @relation(fields: [referenceContentHash], references: [contentHash], onDelete: Restrict)

  @@unique([sourceKind, sourceId])
}
```

`sourceKind` is exactly `generated-asset` and `sourceId` is exactly the
`generatedAssetId`. A promotion is therefore the reusable content-addressed
promotion of one generated asset, not the identity of a later P6 selection.
Several terminal selections may point to the same promotion row while retaining
their own selection lineage.

- [ ] **Step 1: Install the decoder and write failing image/store tests**

From the repository root, outside the sandbox:

```powershell
bun add sharp@latest
```

Then add tests for:

- unsupported magic, magic-versus-decoder format mismatch, and persisted
  canonical MIME-versus-rederived MIME mismatch;
- truncated PNG/JPEG that passes header sniffing but fails full decode;
- decoded dimensions and byte length;
- 20 MiB, `16384` per side, and `64,000,000` pixel limits;
- same bytes deduplicate regardless of multipart client MIME/file name; the
  client header is only a non-security hint and canonical MIME comes from magic
  plus full decode;
- source and encoding-blob IDs equal their actual byte SHA-256 content hash,
  never a random UUID or vendor identifier; a lineage row ID is the stable hash
  of its canonical cache key;
- two different lineage keys may safely point at the same encoding blob;
- concurrent same-hash uploads both succeed and share one DB/file pair;
- a failed loser cannot delete the winner's final file;
- existing DB row with missing/tampered file returns stable
  `REFERENCE_ASSET_MISSING`/`REFERENCE_ASSET_TAMPERED`;
- paths are rooted under `.nbook/text-to-image/references/<prefix>/`;
- public upload rejects client-created `vibe-encoding` derivation fields.
- every reference route requires the current user and an open Project; multipart
  routes accept only a strict `projectPath` query plus one `file` part;
- list returns a strict `{items,page,pageSize,hasMore}` DTO and the UI/API cannot
  misparse it as a bare array;
- replay adopts an existing verified content-addressed orphan file when its DB
  row is absent;
- a tampered existing orphan file fails closed and is never overwritten or
  deleted;
- all missing/tampered/invalid/in-use errors use one shared HTTP mapper.

Run:

```powershell
bunx vitest run server/text-to-image/reference-image.test.ts server/text-to-image/reference-asset-lock.test.ts server/text-to-image/reference-asset.service.test.ts server/text-to-image/asset-path.test.ts --maxWorkers=1
```

Expected: FAIL because `sharp`, the lock, dimensions, integrity checks, and new
storage root are not wired.

- [ ] **Step 2: Add the real Project schema upgrade and regenerate Prisma**

Replace the mixed source/encoding table with the typed models above. Because this
feature is still pre-release, do not migrate the old stub records or copy files
from `assets/text-to-image/references`; old files remain inert.

Update all four Project schema owners:

1. `prisma/project.schema.prisma`;
2. `PROJECT_MIGRATION_SQL` for new Projects;
3. an idempotent `ensureTextToImageP5ReferenceSchema()` invoked from
   `initProjectDatabaseAtRoot()` for old Projects;
4. `server/workspace-files/project-workspace.test.ts` for both new and old
   database shapes.

The ensure function detects the old mixed P5 stub shape, drops only that
pre-release reference table, and recreates the typed tables. It does not touch
generated assets, Recipe Markdown, or historical files.

Run:

```powershell
bun run generate
```

Expected: generated Project client exposes the four P5 models.

- [ ] **Step 3: Implement full image verification**

`reference-image.ts` must:

- calculate SHA-256 from the supplied bytes;
- sniff magic independently from the claimed MIME;
- decode the entire image with `sharp(..., {failOn: "error", limitInputPixels: 64_000_000})`;
- require exact decoded width/height bounds;
- return immutable `{contentHash,mimeType,byteLength,width,height}`;
- support only PNG/JPEG source images;
- expose a second read-and-reverify function for persisted files.

Do not normalize or rewrite bytes.

- [ ] **Step 4: Implement the cross-process lock and atomic pair**

Expose:

```ts
export async function withTextToImageReferenceMutationLock<T>(
    projectPath: string,
    operation: (scope: TextToImageReferenceMutationScope) => Promise<T>,
): Promise<T>;
```

Use `proper-lockfile` on a stable file beneath
`.nbook/text-to-image/references/`. Inside the lock:

1. write to a bounded sibling temp file with `wx`;
2. sync and close the file;
3. if the content-addressed final path already exists, read, hash, and fully
   reverify it; adopt it only when it matches, then delete only this request's
   temp file;
4. otherwise publish with no-overwrite semantics that do not depend on Windows
   rename replacement behavior;
5. create-or-read the DB record, including adoption of a verified orphan file;
6. on uniqueness conflict, re-read and reverify the existing record/file;
7. remove only the current request's temp file;
8. never overwrite, compensate-delete, or replace an existing final file.

`TextToImageReferenceMutationScope` is an in-memory capability created after lock
acquisition and invalidated before release. Lock-held asset/promotion primitives
accept that scope instead of reacquiring the file lock.

Public upload/list/read/content/delete methods return metadata only or a
server-internal verified file handle. No endpoint receives a path.

Set each source and encoding-blob `id` to its actual byte `contentHash`; derive
the lineage row ID from the canonical cache key. Define and use
`TextToImageReferenceAssetPageDtoSchema` in the shared contract; the GET route
and panel both strict-parse the page and consume `.items`.

Keep paginated list reads cheap: return frozen DB metadata plus `stat`-level
missing/size-mismatch status, but do not hash and decode up to 30 full images
just to render badges. Content reads, explicit validation, import replay,
promotion, and paid-attempt resolution perform the full byte/hash/decode check.
When one of those returns `REFERENCE_ASSET_TAMPERED`, the store marks that item
and refreshes its list state.

Map stable reference errors through
`server/text-to-image/reference-asset-http-error.ts` from every route. Task 3
also maps the same codes through
`illustration-execution-http-error.ts`.

- [ ] **Step 5: Make multipart limits effective while streaming**

Extract the Busboy pattern from the Agent attachment route into
`server/utils/bounded-file-multipart.ts`, then keep the Agent route on that shared
helper. Reference upload/import routes put `projectPath` in the query and accept
exactly one `file` part:

- source upload limit: `20 MiB`;
- Vibe container limit: `32 MiB`;
- exact one-file/zero-field/part-count limits;
- abort, overflow, and second-part rejection before unbounded buffering.

Add real `IncomingMessage`/handler tests modelled after
`attachments.post.test.ts`; static source inspection alone is insufficient.

- [ ] **Step 6: Run the storage and API tests**

Run the Step 1 command plus:

```powershell
bunx vitest run server/utils/bounded-file-multipart.test.ts "server/api/agent/sessions/[sessionId]/attachments.post.test.ts" server/text-to-image/reference-asset-http-error.test.ts server/api/text-to-image/reference-assets/index.post.test.ts server/api/text-to-image/reference-assets/reference-asset-api-contract.test.ts server/workspace-files/project-workspace.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit the storage slice**

Suggested commit:

```text
feat(text-to-image): verify content addressed reference assets
```

---

### Task 3: Put production Compiler preflight and dual Inpaint on the only path

**Files:**

- Modify: `server/text-to-image/illustration-compiler.ts`
- Modify: `server/text-to-image/illustration-compiler.test.ts`
- Modify: `server/text-to-image/illustration-execution.compiler.ts`
- Modify: `server/text-to-image/illustration-execution.compiler.test.ts`
- Modify: `server/text-to-image/recipe.service.ts`
- Modify: `server/text-to-image/recipe.service.test.ts`
- Create: `server/api/text-to-image/jobs/index.post.test.ts`
- Modify: `server/text-to-image/illustration-execution-http-error.ts`
- Create: `server/text-to-image/illustration-execution-http-error.test.ts`
- Modify: `server/text-to-image/registration-projection.test.ts`
- Modify: `server/text-to-image/execution.repository.ts`
- Modify: `server/text-to-image/execution.repository.test.ts`
- Modify: `server/text-to-image/illustration-execution.service.ts`
- Modify: `server/text-to-image/illustration-execution.service.test.ts`
- Modify: `server/text-to-image/execution.test-fixtures.ts`
- Modify: `server/text-to-image/queue.service.ts`
- Modify: `server/text-to-image/queue.service.test.ts`
- Modify: `prisma/project.schema.prisma`
- Modify (generated): `server/generated/project-prisma/**`
- Modify: `server/workspace-files/project-workspace.ts`
- Modify: `server/workspace-files/project-workspace.test.ts`

- [ ] **Step 1: Write failing production-path tests**

Prove through `ProductionIllustrationExecutionCompiler`, not only the shared
helper, that:

- every selected hash resolves to typed DB metadata and an existing file with the
  recorded byte length, without reading file bytes;
- preflight receives frozen MIME/dimensions and is called exactly once;
- incomplete or missing references block Preview before Manifest/Job creation;
- base/mask dimensions and V4.5 Full mapping are frozen;
- the reference snapshot hash changes with MIME, dimensions, kind, strength,
  info, model, action, or encoder version;
- Manifest persists `additionalCostLowerBound`, not `knownCost`;
- authorization persists `acceptedAdditionalCostLowerBound` and
  `acceptedTokenLowerBound`, not misleading `authorized*Limit` fields, and
  requires exact equality with Preview before hashing/registration;
- Recipe save, Manifest registration, reference deletion, and later promotion
  share the mutation lock, so a delete cannot race an owner write.
- deleting after Preview/out-of-lock compile but before authorization makes the
  lock-held revalidation fail with zero closure rows; deleting after lock-held
  revalidation waits and then sees the committed Manifest owner;
- manual compile rejects any non-empty reference selection with
  `TEXT_TO_IMAGE_MANUAL_REFERENCES_UNSUPPORTED`, while reference-free manual
  jobs keep their current queue behavior;
- `queue.service.ts::assertRecipeCompiledRequest()` enforces the same
  reference-free invariant for internal enqueue and persisted retry/recovery, so
  no historical or hand-built manual `requestJson` can silently drop references.
- dispatch registration uses v3 and rejects any v2 outbox/receipt closure under
  the new request contract.

Run:

```powershell
bunx vitest run server/text-to-image/illustration-compiler.test.ts server/text-to-image/illustration-execution.compiler.test.ts server/text-to-image/recipe.service.test.ts server/api/text-to-image/jobs/index.post.test.ts server/text-to-image/illustration-execution-http-error.test.ts server/text-to-image/execution.repository.test.ts server/text-to-image/registration-projection.test.ts server/text-to-image/illustration-execution.service.test.ts server/text-to-image/queue.service.test.ts --maxWorkers=1
```

Expected: FAIL on the old existence-only verifier, single mask, and cost field.

- [ ] **Step 2: Rewire the compiler**

- replace `referenceAssetVerifier` with a metadata verifier that returns typed
  upload-time evidence and performs only existence/size checks;
- call `preflightNovelAiCapabilities()` after effective model and reference
  evidence are known;
- construct the discriminated request from the returned action/wire model;
- freeze the reference snapshot hash and lower bounds;
- surface registry errors through existing stable HTTP/compiler error mapping;
- do not create a Manifest or authorization from any failed preflight.
- bump `ILLUSTRATION_DISPATCH_REGISTRATION_VERSION` to
  `route-b-dispatch-registration-v3`; the P5 hard-cut upgrader removes old
  pending v2 outboxes before the new repository accepts work.

Keep `requestNovelAiImages()` and its plain manual queue caller. Add the
reference-free guard in `compileManual()` and map it through the Recipe HTTP error
boundary; do not project Recipe references into manual `PersistedRequest`.
Repeat the fail-closed assertion in
`queue.service.ts::assertRecipeCompiledRequest()` as the final invariant for
internal enqueue, retry, and recovery.

Add `ensureTextToImageP5ExecutionSchema()` after the P5 reference helper. It
updates new-Project SQL and hard-cuts the pre-P5 Manifest/Approval contract:

- remove pending dispatch outboxes whose immutable request/hashes use the old
  contract;
- mark old `queued` strict jobs failed with
  `TEXT_TO_IMAGE_CONTRACT_UPGRADED`;
- mark old `running|completing` strict jobs `outcome_unknown`, never replay them;
- retain terminal Job/asset history but detach obsolete Manifest/Approval IDs;
- recreate Manifest/Approval ownership with
  `additionalCostLowerBound`,
  `acceptedAdditionalCostLowerBound`, and `acceptedTokenLowerBound`.

Perform that entire detach/delete/recreate sequence under one raw SQLite
`BEGIN IMMEDIATE` transaction with rollback on any failure. Tests inject a
mid-upgrade exception and prove the old closure remains wholly readable; a
successful retry then converges exactly once.

Do not add a compatibility reader or reinterpret an old user-entered “limit” as
new lower-bound evidence. New initializer/upgrader tests prove the hard cut is
idempotent and never deletes generated assets.

- [ ] **Step 3: Serialize reference-owner mutations**

Wrap Recipe save and Manifest registration in the same Project reference mutation
lock. Internal methods accept the active
`TextToImageReferenceMutationScope` capability created by Task 2; never accept a
forgeable `lockHeld: boolean` or reacquire the lock. Keep transactions bounded
and never perform a remote request while holding the lock.

Manifest registration re-reads the frozen reference rows and stat evidence while
the same scope is active, then opens the one Project transaction that writes
Manifest, Approval, Job, and outbox before releasing the scope. Preview evidence
or an out-of-lock recompile is not enough: a delete between Preview and
authorization must make registration fail, never create a dangling Manifest.

- [ ] **Step 4: Run the focused production tests**

Regenerate the Project client before the tests because this slice renames a
persisted Manifest cost field:

```powershell
bun run generate
```

Run the Step 1 command again.

Then run the real Project upgrader coverage:

```powershell
bunx vitest run server/workspace-files/project-workspace.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit the compiler slice**

Suggested commit:

```text
feat(text-to-image): preflight frozen P5 execution requests
```

---

### Task 4: Strictly parse and atomically import `.naiv4vibe` and `.vibe`

**Files:**

- Create: `shared/text-to-image-vibe-container.ts`
- Create: `shared/text-to-image-vibe-container.test.ts`
- Create: `server/text-to-image/vibe-container.parser.ts`
- Create: `server/text-to-image/vibe-container.parser.test.ts`
- Create: `server/text-to-image/vibe-container.test-fixture.ts`
- Create: `server/text-to-image/vibe-import.service.ts`
- Create: `server/text-to-image/vibe-import.service.test.ts`
- Create: `server/api/text-to-image/reference-assets/import-vibe.post.ts`
- Create: `server/api/text-to-image/reference-assets/import-vibe.post.test.ts`
- Create: `server/api/text-to-image/reference-assets/reference-asset-import-api-contract.test.ts`
- Modify: `server/text-to-image/reference-asset.service.ts`

`shared/text-to-image-vibe-container.ts` owns only strict public DTO schemas,
limits, advertised extensions, and import-response schemas. It must not expose
`Uint8Array`, parsed vendor internals, or a second bucket/model map.

**Server-only parser result** (declared in
`server/text-to-image/vibe-container.parser.ts`):

```ts
export type ParsedVibeContainer = {
    containerContentHash: string;
    source: {
        bytes: Uint8Array;
        evidence: FrozenReferenceAsset;
    };
    providerModel: "nai-diffusion-4-5-full";
    encoderVersion: "novelai-vibe/v4-5full/v1";
    suggestedStrength: number;
    encodings: Array<{
        informationExtracted: number;
        canonicalInformation: string;
        bytes: Uint8Array;
        contentHash: string;
    }>;
    display: {
        name: string | null;
        createdAt: string | null;
        thumbnail: Uint8Array | null;
    };
};
```

- [ ] **Step 1: Build a deterministic synthetic fixture and failing parser tests**

The fixture builder emits valid JSON bytes and accepts narrow overrides. Test all
approved limits:

- container `32 MiB`;
- JSON depth `8` and total keys `256`;
- exact identifier/version/type;
- strict Base64 including round-trip canonicality;
- exactly one `v4-5full` bucket;
- `1..16` encodings;
- source/image/thumbnail/encoding decoded byte limits;
- source dimensions and pixel limit;
- strict vendor ID/map-key shape without using either as identity;
- finite `0..1` strength/info;
- duplicate canonical information values;
- model/bucket mismatch;
- per-byte SHA-256;
- `.vibe` and `.naiv4vibe` go through the same parser.
- import route enforces current-user/open-Project ownership before buffering the
  bounded file.

Add an optional local-only conformance test:

```ts
const privateSample = process.env.NBOOK_PRIVATE_NAIV4VIBE_SAMPLE;
it.skipIf(!privateSample)("parses the private NovelAI v1 sample", async () => {
    const parsed = await parseVibeContainer(await fs.readFile(privateSample!));
    expect(parsed.providerModel).toBe("nai-diffusion-4-5-full");
    expect(parsed.encodings.length).toBeGreaterThan(0);
});
```

Never snapshot or print vendor metadata, raw bytes, hashes, or the private path.

Run:

```powershell
bunx vitest run shared/text-to-image-vibe-container.test.ts server/text-to-image/vibe-container.parser.test.ts server/text-to-image/vibe-import.service.test.ts --maxWorkers=1
```

Expected: FAIL because the parser/import service does not exist.

- [ ] **Step 2: Implement the strict parser**

Reject the whole container at the first invalid boundary. Parse display metadata
only after safety validation; it must not affect identity, cache keys, or Recipe.
`importInfo.strength` is returned as a suggestion only.

Resolve the accepted bucket to provider model and `encoderVersion` through the
single provider registry from Task 1. The parser validates vendor bucket shape
but must not own a duplicate model/encoder lookup table.

- [ ] **Step 3: Implement all-or-nothing import**

Inside one reference mutation lock:

1. parse and verify every byte set before publishing any record;
2. stage source and all encodings;
3. publish content-addressed files;
4. in one Project transaction create-or-read the source, encoding blobs, and all
   typed cache-lineage records with provenance `naiv4vibe-import`;
5. on replay, verify every existing file and return the same records;
6. on DB failure, leave only content-addressed orphan files that a replay can
   adopt; never leave a partial logical import row set;
7. do not change Recipe.

The route uses the shared streaming multipart helper, accepts one bounded file,
and ignores its extension for parsing; UI may advertise both extensions.

- [ ] **Step 4: Run parser/import/API tests**

Run the Step 1 command plus:

```powershell
bunx vitest run server/api/text-to-image/reference-assets/import-vibe.post.test.ts server/api/text-to-image/reference-assets/reference-asset-import-api-contract.test.ts --maxWorkers=1
```

Optionally, with the user-provided private sample:

```powershell
$env:NBOOK_PRIVATE_NAIV4VIBE_SAMPLE = 'C:\Users\admir\Downloads\6f233a-d45ae0.naiv4vibe'
bunx vitest run server/text-to-image/vibe-container.parser.test.ts --maxWorkers=1
Remove-Item Env:NBOOK_PRIVATE_NAIV4VIBE_SAMPLE
```

Expected: committed synthetic tests PASS; optional test PASS without emitting
private evidence.

- [ ] **Step 5: Commit the import slice**

Suggested commit:

```text
feat(text-to-image): import strict NovelAI vibe containers
```

---

### Task 5: Prove cache lineage and assemble bytes only after `attempt_started`

**Files:**

- Create: `server/text-to-image/vibe-encoding.service.ts`
- Create: `server/text-to-image/vibe-encoding.service.test.ts`
- Modify: `server/text-to-image/novelai-image-generation.ts`
- Modify: `server/text-to-image/novelai-image-generation.test.ts`
- Modify: `server/text-to-image/project-illustration-dispatch.ts`
- Modify: `server/text-to-image/project-illustration-dispatch.test.ts`
- Modify: `server/text-to-image/illustration-dispatch.worker.test.ts`
- Modify: `server/text-to-image/provider-lane.worker.test.ts`
- Modify: `server/text-to-image/reference-asset.service.ts`
- Modify: `server/text-to-image/reference-asset.service.test.ts`

**Resolver boundary:**

```ts
export interface CompiledNovelAiReferenceResolver {
    readSource(evidence: FrozenReferenceAsset): Promise<Uint8Array>;
    readVibeEncoding(input: {
        sourceContentHash: string;
        providerModel: NovelAiProviderModelId;
        informationExtracted: number;
        encoderVersion: NovelAiVibeEncoderVersion;
    }): Promise<Uint8Array | null>;
    storeRemoteVibeEncoding(input: {
        source: FrozenReferenceAsset;
        providerModel: NovelAiProviderModelId;
        informationExtracted: number;
        encoderVersion: NovelAiVibeEncoderVersion;
        bytes: Uint8Array;
    }): Promise<void>;
}
```

- [ ] **Step 1: Write failing paid-window and wire-equivalence tests**

Prove:

- Project preflight before `attempt_started` reads metadata only, never reference
  bytes;
- resolver byte reads and `/ai/encode-vibe` can occur only inside
  `ProjectIllustrationDispatch.execute()` after the lane start fence;
- the ephemeral Project `PrismaClient` already opened by dispatch is injected
  into the reference resolver/service; closed-Project background work never
  falls back to the active-Project singleton;
- imported cache hit performs zero encode calls;
- source/model/info/encoder-version mismatch fails closed;
- imported and remote encodings produce byte-for-byte identical Base64 values in
  `reference_image_multiple`;
- only the final HTTP boundary performs Base64 conversion;
- a file changed after authorization is caught by SHA-256, byte-length, magic,
  full-decode, MIME, and dimensions before `/ai/encode-vibe` or
  `/ai/generate-image`; the attempt becomes a stable non-retryable reference
  failure and makes zero remote calls;
- Inpaint sends the verified base bytes as `parameters.image`, the original mask
  bytes as `parameters.mask`, `model` as frozen `wireModel`, and action `infill`;
- generate sends no image or mask fields;
- thrown network/timeout ambiguity still yields `outcome_unknown` without replay.

Run:

```powershell
bunx vitest run server/text-to-image/vibe-encoding.service.test.ts server/text-to-image/novelai-image-generation.test.ts server/text-to-image/project-illustration-dispatch.test.ts server/text-to-image/illustration-dispatch.worker.test.ts server/text-to-image/provider-lane.worker.test.ts --maxWorkers=1
```

Expected: FAIL because current adapter reads one mask, sends action `inpaint`,
uses the generate model, and caches without encoder version.

- [ ] **Step 2: Implement typed encoding cache resolution**

Use the unique key
`sourceContentHash + providerModel + canonicalInformation + encoderVersion`.
On hit, resolve the lineage to its content-addressed blob and verify encoding
byte length/hash plus source/model/info/version lineage. On miss, call
`/ai/encode-vibe`, then persist/reuse the blob and create the
`remote-encode` lineage under the reference lock. A uniqueness loser re-reads
and verifies the winner. Different cache keys may share one identical blob.

- [ ] **Step 3: Rebuild the compiled NovelAI wire projection**

- resolve source/encoding bytes from frozen evidence only;
- construct the production resolver with the current ephemeral Project client;
  do not instantiate the default active-Project client inside background dispatch;
- reverify every source and encoding byte set against its frozen evidence before
  making any remote call, and map deterministic integrity errors to `failed`
  rather than `outcome_unknown`;
- use the frozen `wireModel` and action;
- project Vibe/Precise arrays in frozen order;
- for Inpaint, set the verified base and original mask Base64 at the last request
  boundary;
- keep `n_samples: 1` in P5;
- return the generate model and wire model as non-secret execution evidence;
- consume the registry-backed V4-family helper/capability from Task 1 for
  caption, SMEA, sampler, and noise branches; remove the adapter's private
  `isV4Model()` implementation;
- remove the comment that marks the Inpaint wire as unverified.

- [ ] **Step 4: Remove browser-shaped reference paths**

Delete `imageDataUrl`, `vibeEncoding`, `naiv4vibe`, `naiv4vibebundle`, and
client-derived encoding handling from `TextToImageGenerateRequestSchema` and
the browser-shaped `generateNovelAiImage()` facade after a repository-wide call
graph proves those two exports have no production caller. Keep
`requestNovelAiImages()` and the plain manual queue builder; they remain
reference-free through Task 3's explicit guard.

Add a source scan that permits Base64 only in the adapter/container parser tests
and final HTTP projection, and forbids these fields in shared execution contracts,
Project DB JSON, queue/outbox code, and UI store.

- [ ] **Step 5: Run the focused paid-window suite**

Run the Step 1 command again.

Expected: PASS.

- [ ] **Step 6: Commit the adapter slice**

Suggested commit:

```text
feat(text-to-image): resolve P5 references inside paid attempts
```

---

### Task 6: Add transaction-capable promotion and complete safe deletion

**Files:**

- Modify: `server/text-to-image/asset.service.ts`
- Modify: `server/text-to-image/asset.service.test.ts`
- Create: `server/text-to-image/reference-promotion.service.ts`
- Create: `server/text-to-image/reference-promotion.service.test.ts`
- Modify: `server/text-to-image/reference-asset.service.ts`
- Modify: `server/text-to-image/reference-asset.service.test.ts`
- Modify: `server/text-to-image/recipe.codec.ts`
- Modify: `server/text-to-image/execution.repository.ts`
- Modify: `prisma/project.schema.prisma`
- Modify (generated): `server/generated/project-prisma/**`
- Modify: `server/workspace-files/project-workspace.ts`
- Modify: `server/workspace-files/project-workspace.test.ts`

**Required API:**

```ts
export class TextToImageReferencePromotionService {
    async prepareGeneratedPromotion(input: {
        projectPath: string;
        generatedAssetId: string;
        expectedContentHash: string;
    }): Promise<PreparedGeneratedPromotion>;

    async commitPreparedPromotion(input: {
        transaction: Prisma.TransactionClient;
        prepared: PreparedGeneratedPromotion;
    }): Promise<TextToImageReferencePromotion>;
}
```

The two methods are available only through a lock-scoped port:

```ts
await withTextToImageReferenceMutationLock(projectPath, async (scope) => {
    const prepared = await scope.promotion.prepareGeneratedPromotion(...);
    return client.$transaction(async (transaction) =>
        scope.promotion.commitPreparedPromotion({transaction, prepared}));
});
```

The scoped port cannot escape the callback. Neither method reacquires or releases
the lock; P6 can therefore hold one lock across prepare, selection, and promotion
commit.

- [ ] **Step 1: Write failing promotion/delete tests**

Cover:

- generated file missing, hash mismatch, MIME mismatch, and full-decode failure;
- successful content-addressed copy preserves bytes and dimensions;
- the same generated asset replay returns the same reference/promotion even when
  two later P6 selections point to it;
- two different generated asset IDs with identical bytes share one
  content-addressed reference asset but create two distinct promotion rows;
- every row persists `sourceKind === "generated-asset"` and
  `sourceId === generatedAssetId`;
- the same generated asset with conflicting expected content evidence fails;
- an existing promotion whose generated content, reference content, or fixed
  source identity conflicts fails closed rather than being adopted;
- promotion preparation performs no selection write;
- `commitPreparedPromotion()` participates in the caller's Project transaction;
- caller transaction failure may leave only a verified content-addressed orphan
  reference file; replay verifies/adopts it and never deletes another writer's
  file;
- generated-asset deletion rejects an existing promotion with a stable owner
  error, backed by the restrictive relation rather than only an optimistic
  service check;
- reference deletion rejects Recipe, Manifest/CompiledRequest, Vibe child, and
  promotion lineage owners;
- unreferenced deletion uses a hash-labelled tombstone and never removes a
  shared file;
- crash recovery restores `row present + tombstone present` to the verified
  final path, and removes `row absent + tombstone present`; it never guesses
  about an unrecognized tombstone;
- invalid Recipe or Manifest owner evidence fails closed with a stable error and
  leaves row/file untouched;
- concurrent delete versus Recipe/Manifest/promotion is serialized by the same
  lock.
- concurrent generated-asset delete versus promotion is serialized by the same
  lock: delete-first makes promotion fail missing, promotion-first makes delete
  fail in-use, and neither order leaves dangling lineage; injected transaction
  failure preserves the original asset and creates no promotion row.

Run:

```powershell
bunx vitest run server/text-to-image/reference-promotion.service.test.ts server/text-to-image/reference-asset.service.test.ts server/text-to-image/asset.service.test.ts server/text-to-image/execution.repository.test.ts server/workspace-files/project-workspace.test.ts --maxWorkers=1
```

Expected: FAIL because generated assets have no verified hash evidence and
promotion/safe-owner checks do not exist.

- [ ] **Step 2: Record generated asset integrity evidence**

When `TextToImageAssetService.save()` writes any generated image, compute and
store its content hash. Route-B illustration and candidate assets additionally
store their strict compiled revision/hash; the plain manual queue has no strict
CompiledRequest, so those two fields remain null and the asset is never eligible
for P6 review. Reverify the available evidence during content read, promotion,
and P6 candidate freezing. Keep the normal generated-asset path unchanged;
promotion copies bytes into the reference store.

Add these nullable columns for pre-P5 generated rows through an idempotent
`ensureTextToImageP5GeneratedAssetSchema()` that runs after the reference and
execution helpers:

```prisma
contentHash         String?
compiledRequestHash String?
compiledRevision    String?
```

Every new asset must populate `contentHash`. Every new Route-B
illustration/candidate asset must populate all three fields. Tests must prove
manual assets retain null compiled evidence and are rejected by P6, while strict
assets have complete evidence.

Add the inverse `promotions` relation to `TextToImageAsset`. Generated-asset
deletion enters the same Project reference mutation lock before checking
promotion ownership and deleting the row/file; the DB `Restrict` relation is the
final race fence and its error is mapped to the stable generated-owner conflict.

Update the Project Prisma schema, `PROJECT_MIGRATION_SQL`, the idempotent P5
ensure function, and the new/old Project initializer tests, then run:

```powershell
bun run generate
```

Expected: the generated Project client exposes all three nullable evidence
columns before the service changes compile.

- [ ] **Step 3: Implement scoped prepare/commit promotion**

The outer scope holds the reference mutation lock.
`prepareGeneratedPromotion()` verifies the generated record/file, publishes or
reuses the reference file, and returns immutable evidence. It follows the same
orphan publish rules as upload: a matching DB-less final is verified/adopted,
while a tampered final fails closed and is never overwritten or deleted.
`commitPreparedPromotion()` performs only DB create-or-read operations on the
caller's transaction, derives the fixed `generated-asset` source identity from
the prepared evidence, and validates idempotency. Neither method opens its own
lock or transaction. It never uses a selection ID as promotion identity.

Old generated rows with no P5 evidence are not silently adopted for candidate
generation. Promotion may verify and populate their content hash, but if no
strict Job request can derive `compiledRevision`, P6 rejects them and asks the
user to create a new candidate batch.

Do not add a general front-end “promote” button. P6 selection is the first caller.

- [ ] **Step 4: Complete deletion ownership checks**

Inside the lock, parse the current Recipe via its codec, scan immutable Manifest
compiled requests through their strict schema, query Vibe and promotion records,
then delete only when every owner is absent. Expose stable `409` codes naming the
owner category without leaking paths or request JSON. A P6 Candidate Review owns
its generated asset, not a reference asset merely because the bytes happen to
match. Reference deletion remains protected by the promotion row's
`referenceContentHash`; a later selection retains audit lineage through
`promotionId`.

Use this crash-recoverable order:

1. reconcile recognized delete tombstones under the lock;
2. strict-parse every Recipe/Manifest owner; parse failure is
   `REFERENCE_OWNER_EVIDENCE_INVALID`, never “no owner”;
3. rename the verified final file to a unique tombstone containing asset ID and
   content hash;
4. delete the DB row in one Project transaction;
5. after commit, delete the tombstone.

If the process stops after step 3, the row still exists and reconciliation
restores the verified tombstone. If it stops after step 4, the row is absent and
reconciliation deletes the recognized tombstone. Never sweep unknown files or
use path globs outside the reference root.

- [ ] **Step 5: Run the promotion/delete suite**

Run the Step 1 command again.

Expected: PASS.

- [ ] **Step 6: Commit the promotion slice**

Suggested commit:

```text
feat(text-to-image): promote generated assets with durable lineage
```

---

### Task 7: Replace the existing reference panel with the strict P5 controls

**Files:**

- Modify: `app/stores/text-to-image.ts`
- Modify: `app/stores/text-to-image.test.ts`
- Modify: `app/components/novel-ide/text-to-image/TextToImageReferenceAssetsPanel.vue`
- Modify: `app/components/novel-ide/settings/NovelIdeTextToImageSettingsPanel.vue`
- Modify: `app/components/novel-ide/text-to-image/TextToImageIllustrationWorkflowPanel.vue`
- Modify: `app/components/novel-ide/text-to-image/TextToImageAssetDetailDialog.vue`
- Modify: `server/text-to-image/illustration-execution-ui-contract.test.ts`
- Create: `server/text-to-image/reference-asset-ui-contract.test.ts`

- [ ] **Step 1: Write failing store and UI ownership tests**

Prove:

- store exposes one atomic `setInpaintPair(baseHash, maskHash)` and one
  `clearInpaintPair()`, with no single-mask mutation;
- panel uploads only PNG/JPEG source images;
- `.naiv4vibe,.vibe` use the import route and show the returned strength as an
  explicit suggestion;
- import never mutates Recipe until the user adds a Vibe selection;
- only PNG assets can be chosen as masks; PNG/JPEG can be bases;
- current asset metadata and missing/tampered states are visible;
- cost copy says “额外费用下限”, never “已知费用” or “精确费用”;
- no `imageDataUrl`/`vibeEncoding` state remains;
- the store strict-parses the page response and assigns `assets =
  parsed.items`, never treating the page object as an array;
- Settings consumes the registry-derived capability DTO and has no local
  `isV4Model` regex or model-ID substring branch.

Run:

```powershell
bunx vitest run app/stores/text-to-image.test.ts server/text-to-image/reference-asset-ui-contract.test.ts server/text-to-image/illustration-execution-ui-contract.test.ts --maxWorkers=1
```

Expected: FAIL on the existing `setInpaintMask()` and old copy.

- [ ] **Step 2: Implement the focused controls**

Modify the existing `TextToImageReferenceAssetsPanel.vue`; do not create a second
reference panel. Separate:

- source image upload;
- Vibe container import;
- Vibe and Precise selections;
- an explicit base/mask Inpaint pair;
- integrity/error state.

Use existing theme variables and `useNotification()`/
`resolveApiErrorMessage()`. Keep selection order stable and show the server's
verified MIME/dimensions. Preserve the panel's actual mount in
`NovelIdeTextToImageSettingsPanel.vue`; update Workflow/Asset Detail only for the
renamed conservative-cost display.

Remove the Settings panel's local V4 regex. Model availability, reference
compatibility, and capability copy come from the typed registry-derived DTO; the
UI may format labels but cannot infer capabilities from model IDs.

- [ ] **Step 3: Run the UI/store tests**

Run the Step 1 command again.

Expected: PASS.

- [ ] **Step 4: Commit the UI slice**

Suggested commit:

```text
feat(text-to-image): expose strict P5 reference controls
```

---

### Task 8: Verify P5 as a production and product-runtime slice

**Files:**

- Modify only if a test reveals a P5 defect.
- Modify: `scripts/build/patch-nitro-runtime-deps.mjs`
- Modify: `scripts/deploy/product-runtime.mjs`
- Modify if externalization requires it: `nuxt.config.ts`
- Do not update `PROJECT-STATUS.md` or the task walkthrough here; the delivery
  index owns the final combined documentation update.

- [ ] **Step 1: Re-run every Task 1–7 GREEN command**

Run each focused command exactly as recorded in Tasks 1–7, including route
handler tests, Agent multipart regressions, `registration-projection.test.ts`,
queue recovery, and `server/workspace-files/project-workspace.test.ts`. Also run
the existing P0–P4 regression owners:

```powershell
bunx vitest run server/text-to-image/illustration-result.service.test.ts server/text-to-image/registration-projection.test.ts server/workspace-files/project-workspace.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 2: Run static boundary scans**

```powershell
rg -n --glob '!**/*.test.ts' --glob '!**/*.test-fixture.ts' 'imageDataUrl|vibeEncoding|naiv4vibebundle|knownCost|authorizedCostLimit|authorizedTokenLimit|setInpaintMask|action:\s*["'']inpaint["'']' shared server/text-to-image server/api/text-to-image app/stores app/components/novel-ide/text-to-image app/components/novel-ide/settings prisma/project.schema.prisma
rg -n --glob '!**/*.test.ts' --glob '!**/*.test-fixture.ts' "assets/text-to-image/references" shared server app prisma
rg -n --glob '!**/*.test.ts' --glob '!**/*.test-fixture.ts' "Base64|base64|Uint8Array|Buffer" shared/text-to-image-execution.ts shared/text-to-image-dispatch.ts server/text-to-image/execution.repository.ts server/text-to-image/provider-lane.repository.ts
rg -n --glob '!shared/text-to-image-provider-registry.ts' --glob '!**/*.test.ts' --glob '!**/*.test-fixture.ts' 'isV4Model|nai-diffusion-4\(\?:-|includes\(["'']diffusion-4["'']\)' shared server/text-to-image app/components/novel-ide/settings
```

Expected:

- first scan has no production hits;
- second scan has no production hits;
- third scan has no persisted contract/repository hits.
- fourth scan has no duplicate production capability predicate.

- [ ] **Step 3: Regenerate and run type/build gates**

Run outside the sandbox where Bun/native dependency execution requires it:

```powershell
bun run generate
bun run typecheck
bun run build
bun run nuxt:build
bun run product:stage
```

Expected:

- generated Prisma output matches the schema;
- P5 introduces no new type errors beyond an explicitly recorded repository
  baseline;
- Nuxt/Nitro build succeeds;
- `patch-nitro-runtime-deps.mjs` vendors `sharp` and the current platform's
  optional native package;
- `product-runtime.mjs` resolves `sharp` from staged `.output`, decodes fixed
  tiny PNG bytes embedded in the smoke script, and reports dimensions without
  loading development `node_modules`; the smoke fixture itself must not be
  produced by `sharp`.

- [ ] **Step 4: Keep visible product acceptance optional**

The automated product gate ends at staged-runtime native decode and server-side
tests. If the user wants a visible upload/import acceptance check, ask separately
before opening or controlling a browser; stop before any paid generation action.

Expected automated result: no native-module load error. Visible restart behavior
is reported as unverified unless the user explicitly authorizes that check.

- [ ] **Step 5: Request independent review**

The reviewer compares the implementation with approved specification sections
8, 11, 12.2, and 13.3 and reports:

- any second capability/action/cost map;
- any unverified byte or MIME trust boundary;
- any persisted Base64/path/raw byte;
- any paid-window byte read before `attempt_started`;
- any non-atomic import/upload/promotion/delete race;
- any unsupported model silently allowed for Inpaint;
- any committed private sample evidence.

Resolve blocking findings and rerun Tasks 1–8 focused gates before P6 begins.
