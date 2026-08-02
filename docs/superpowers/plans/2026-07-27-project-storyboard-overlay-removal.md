# Project Storyboard Overlay Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the complete Project Storyboard/Tag Pattern incremental-overlay control plane while preserving the approved global Storyboard/Pattern companion pair as the only Planning and Compiler truth source.

**Architecture:** Extract the global companion validation and read path currently buried inside `ProjectOverlayService` into a small read-only service. Rewire both production consumers to that service, then delete the Project editor/API/codecs/resolvers and the overlay portions embedded in the base shared schemas. Historical Project overlay files remain untouched and inert.

**Tech Stack:** TypeScript, Zod, Nuxt/H3, Vue 3, Vitest, global profile-home files.

## Global Constraints

- Execute this plan before the P5 Compiler work and before the character plan edits `NovelTextToImagePanel.vue`.
- Preserve the global Storyboard Preset schema/codec, Tag Pattern schema/codec, selector, default-companion initialization, import, publish, and retrieval infrastructure.
- Planning and Compiler must read the same approved global companion pair through one implementation.
- Never read, migrate, rewrite, or delete historical Project overlay files.
- Do not keep an overlay DTO/schema/codec/resolver “for later”; the production protocol is removed.
- Do not rename the existing global Storyboard or Pattern formats in this task.
- Do not run browser verification automatically.
- Run every `bun`/`bunx` command in this plan outside the sandbox, per repository
  policy.

---

### Task 1: Establish the approved global companion as a standalone truth source

**Files:**

- Create: `server/text-to-image/storyboard-companion.ts`
- Create: `server/text-to-image/storyboard-companion.test.ts`
- Create: `server/text-to-image/storyboard-planning-snapshot.service.ts`
- Create: `server/text-to-image/storyboard-planning-snapshot.service.test.ts`
- Modify: `server/text-to-image/tag-pattern-resolver.ts`
- Modify: `server/text-to-image/tag-pattern-resolver.test.ts`
- Modify: `server/text-to-image/storyboard-preset-init.ts`
- Modify: `server/text-to-image/storyboard-preset-init.test.ts`

**Interfaces:**

```ts
export type StoryboardPlanningSnapshot = {
    preset: {
        presetId: string;
        semanticHash: string;
        rules: StoryboardRule[];
        provenance: Array<{
            ruleId: string;
            scope: "base";
            operation: "base";
            sourceEntryId: string | null;
        }>;
    };
    patterns: {
        patternSetId: string;
        planningHash: string;
        renderHash: string;
        patterns: TagPattern[];
        provenance: Array<{
            patternId: string;
            scope: "base";
            operation: "base";
            sourceEntryId: string | null;
        }>;
    };
};

export class StoryboardPlanningSnapshotService {
    read(): Promise<StoryboardPlanningSnapshot>;
}
```

- [ ] **Step 1: Add failing companion and snapshot tests**

Move the existing approved-pair assertions from `tag-pattern-resolver.test.ts` into
`storyboard-companion.test.ts`, then add these cases:

```ts
it("rejects a disabled, pending, missing, or identity-mismatched companion", () => {
    expect(() => assertStoryboardPatternPair({
        preset: createApprovedPreset(),
        patternSet: createPatternSet({presetId: "other"}),
    })).toThrow("TAG_PATTERN_SET_STALE");
});
```

In `storyboard-planning-snapshot.service.test.ts`, use injected in-memory ports and assert:

```ts
const snapshot = await service.read();

expect(snapshot.preset).toMatchObject({
    presetId: "default",
    semanticHash: createStoryboardPresetHashes(preset).semanticHash,
});
expect(snapshot.preset.provenance).toEqual(preset.rules.map((rule) => ({
    ruleId: rule.ruleId,
    scope: "base",
    operation: "base",
    sourceEntryId: rule.sourceEntryId ?? null,
})));
expect(snapshot.patterns).toMatchObject({
    patternSetId: "default",
    planningHash: createTagPatternSetHashes(patternSet).planningHash,
    renderHash: createTagPatternSetHashes(patternSet).renderHash,
});
expect(readGlobal).toHaveBeenCalledWith("storyboard-presets/default.md");
expect(readGlobal).toHaveBeenCalledWith("tag-patterns/default.md");
```

Also cover:

- default initialization runs before selector/global reads;
- missing preset and missing companion produce stable `STORYBOARD_PRESET_STALE` /
  `TAG_PATTERN_SET_STALE` errors;
- pending or drifted global content is rejected;
- no port accepts `projectPath` and no Project file read occurs.

- [ ] **Step 2: Run the new tests and confirm RED**

Run:

```powershell
bunx vitest run server/text-to-image/storyboard-companion.test.ts server/text-to-image/storyboard-planning-snapshot.service.test.ts
```

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Extract the companion invariant**

Create `storyboard-companion.ts` by moving, not duplicating, the current
`assertStoryboardPatternPair()` implementation from `tag-pattern-resolver.ts`:

```ts
/** 确认 selector 指向同一份已启用、已批准且身份一致的 Storyboard/Pattern companion。 */
export function assertStoryboardPatternPair(input: {
    preset: StoryboardPreset;
    patternSet: TagPatternSet | null;
}): {presetId: string; packageId: string; resourceKey: string} {
    const preset = StoryboardPresetSchema.parse(input.preset);
    if (!preset.enabled || resolveStoryboardReviewState(preset) !== "approved") {
        throw new Error("STORYBOARD_PRESET_STALE: Storyboard Preset 未获批准或已漂移");
    }
    if (!input.patternSet) {
        throw new Error("TAG_PATTERN_SET_STALE: Storyboard companion 缺失");
    }
    const patternSet = TagPatternSetSchema.parse(input.patternSet);
    if (!patternSet.enabled || resolveTagPatternReviewState(patternSet) !== "approved") {
        throw new Error("TAG_PATTERN_SET_STALE: Tag Pattern Set 未获批准或已漂移");
    }
    if (preset.presetId !== patternSet.presetId
        || preset.patternSetId !== patternSet.patternSetId
        || preset.packageId !== patternSet.packageId
        || preset.resourceKey !== patternSet.resourceKey) {
        throw new Error("TAG_PATTERN_SET_STALE: Storyboard/Pattern companion identity 不一致");
    }
    return {presetId: preset.presetId, packageId: preset.packageId, resourceKey: preset.resourceKey};
}
```

Change `storyboard-preset-init.ts` to import the function from the new module. Its
existing behavior—preserve unknown user content and let strict reading report the
error—must not change.

- [ ] **Step 4: Implement the read-only global snapshot service**

Use narrow injectable ports:

```ts
export type StoryboardPlanningSnapshotPorts = {
    ensureDefault(): Promise<void>;
    readSelector(): Promise<IllustrationDirectorSelectorSnapshot>;
    readGlobal(path: string): Promise<string | null>;
};
```

The production adapter uses:

- `ensureDefaultStoryboardPreset()`;
- `readIllustrationDirectorSelectorSnapshot()`;
- `createGlobalProfileHomeFacade(resolveGlobalProfileNbookRoot(), "illustration.director")`.

The `read()` order is fixed:

1. initialize the default pair;
2. read `selector.storyboardPresetKey`;
3. derive the companion path by replacing `storyboard-presets/` with `tag-patterns/`;
4. read both global files;
5. parse with `parseStoryboardPresetMarkdown()` and `parseTagPatternMarkdown()`;
6. call `assertStoryboardPatternPair()`;
7. compute hashes using `createStoryboardPresetHashes()` and
   `createTagPatternSetHashes()`;
8. return only base provenance.

Do not calculate a second “effective” hash: with no overlay, the approved global
semantic/planning/render hashes are the effective hashes.

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
bunx vitest run server/text-to-image/storyboard-companion.test.ts server/text-to-image/storyboard-planning-snapshot.service.test.ts server/text-to-image/storyboard-preset-init.test.ts
```

Expected: all listed files PASS.

- [ ] **Step 6: Commit the truth-source extraction**

```powershell
git add server/text-to-image/storyboard-companion.ts server/text-to-image/storyboard-companion.test.ts server/text-to-image/storyboard-planning-snapshot.service.ts server/text-to-image/storyboard-planning-snapshot.service.test.ts server/text-to-image/storyboard-preset-init.ts server/text-to-image/storyboard-preset-init.test.ts
git commit -m "refactor(text-to-image): isolate global storyboard truth"
```

---

### Task 2: Rewire Planning and Compiler before removing overlay code

**Files:**

- Modify: `server/text-to-image/illustration-planning-input.builder.ts`
- Modify: `server/text-to-image/illustration-planning-input.builder.test.ts`
- Modify: `server/text-to-image/illustration-execution.compiler.ts`
- Modify: `server/text-to-image/illustration-execution.compiler.test.ts`

**Interfaces:**

```ts
type IllustrationPlanningInputPorts = {
    readPlanningRules(): Promise<StoryboardPlanningSnapshot>;
    // existing unrelated ports remain unchanged
};

type IllustrationExecutionCompilerDependencies = {
    readPlanningRules: StoryboardPlanningSnapshotService["read"];
    // existing unrelated dependencies remain unchanged
};
```

- [ ] **Step 1: Change tests to demand the global-only dependency**

In `illustration-planning-input.builder.test.ts`, rename the fake port:

```ts
readPlanningRules: async () => ({
    preset: {presetId: "default", semanticHash: H("1"), rules: [], provenance: []},
    patterns: {
        patternSetId: "default",
        planningHash: H("2"),
        renderHash: H("4"),
        patterns: [pattern],
        provenance: [{
            patternId: pattern.patternId,
            scope: "base",
            operation: "base",
            sourceEntryId: null,
        }],
    },
}),
```

In `illustration-execution.compiler.test.ts`, replace `readOverlays` with
`readPlanningRules`, and preserve the stale-target test:

```ts
expect(fixture.dependencies.readPlanningRules).not.toHaveBeenCalled();
```

Add a successful compile assertion that the only hashes and patterns passed to
`compile()` are those returned by `readPlanningRules()`.

- [ ] **Step 2: Run both tests and confirm RED**

Run:

```powershell
bunx vitest run server/text-to-image/illustration-planning-input.builder.test.ts server/text-to-image/illustration-execution.compiler.test.ts
```

Expected: FAIL because production types still require `ProjectOverlayService`.

- [ ] **Step 3: Rewire Planning Input Builder**

Remove these imports:

```ts
ProjectOverlayService
ProjectIllustrationPlanningSnapshot
```

Import `StoryboardPlanningSnapshotService` and `StoryboardPlanningSnapshot`.
Replace:

```ts
readEffectiveOverlays(projectPath: string): Promise<ProjectIllustrationPlanningSnapshot>;
```

with:

```ts
readPlanningRules(): Promise<StoryboardPlanningSnapshot>;
```

In `freeze()`, rename `overlays` to `planningRules` and call the port without a
Project path. Replace all three consumers:

```ts
effectivePresetSemanticHash: planningRules.preset.semanticHash,
effectivePatternPlanningHash: planningRules.patterns.planningHash,
provenance: planningRules.patterns.provenance,
```

and build the frozen bundle from `planningRules.preset`.

In `createProductionPorts()`:

```ts
const planningRules = new StoryboardPlanningSnapshotService();

readPlanningRules: async () => planningRules.read(),
```

- [ ] **Step 4: Rewire the production execution Compiler**

Replace `ProjectOverlayService` with `StoryboardPlanningSnapshotService`.
The dependency becomes:

```ts
readPlanningRules: StoryboardPlanningSnapshotService["read"];
```

The production adapter constructs one service and calls it without `projectPath`.
Inside `compile()`, replace `overlays` with `planningRules` and preserve the
existing stale comparison against the shot's frozen planning facts:

```ts
effectivePatterns: {
    presetSemanticHash: planningRules.preset.semanticHash,
    planningHash: planningRules.patterns.planningHash,
    patterns: planningRules.patterns.patterns,
},
```

Do not weaken `ILLUSTRATION_SHOT_STALE`; changing the global pair must still force
the user to re-plan the shot.

- [ ] **Step 5: Run the production-consumer tests**

Run:

```powershell
bunx vitest run server/text-to-image/illustration-planning-input.builder.test.ts server/text-to-image/illustration-execution.compiler.test.ts server/text-to-image/illustration-compiler.test.ts
```

Expected: all listed files PASS, and no tested port accepts a Project overlay.

- [ ] **Step 6: Commit the consumer cutover**

```powershell
git add server/text-to-image/illustration-planning-input.builder.ts server/text-to-image/illustration-planning-input.builder.test.ts server/text-to-image/illustration-execution.compiler.ts server/text-to-image/illustration-execution.compiler.test.ts
git commit -m "refactor(text-to-image): use global storyboard snapshots"
```

---

### Task 3: Delete the Project overlay protocol and ownership surfaces

**Files:**

- Delete: `shared/text-to-image-project-overlays.ts`
- Modify: `shared/text-to-image-storyboard-preset.ts`
- Modify: `shared/text-to-image-storyboard-preset.test.ts`
- Modify: `shared/text-to-image-tag-pattern.ts`
- Modify: `shared/text-to-image-tag-pattern.test.ts`
- Modify: `shared/text-to-image-tag-pattern-retrieval.ts`
- Modify: `shared/text-to-image-tag-pattern-retrieval.test.ts`
- Delete: `server/text-to-image/storyboard-overlay.codec.ts`
- Delete: `server/text-to-image/tag-pattern-overlay.codec.ts`
- Delete: `server/text-to-image/storyboard-rule-resolver.ts`
- Delete: `server/text-to-image/storyboard-rule-resolver.test.ts`
- Delete: `server/text-to-image/tag-pattern-resolver.ts`
- Delete: `server/text-to-image/tag-pattern-resolver.test.ts`
- Delete: `server/text-to-image/project-overlay.service.ts`
- Delete: `server/text-to-image/project-overlay.service.test.ts`
- Delete: `server/text-to-image/project-overlay-http-error.ts`
- Delete: `server/text-to-image/project-overlay.codec.test.ts`
- Modify: `server/text-to-image/illustration-execution-http-error.ts`
- Modify: `server/text-to-image/illustration-workflow-http-error.ts`
- Modify: `server/text-to-image/illustration-workflow.service.ts`
- Modify: `server/text-to-image/tag-pattern-retrieval.ts`
- Delete: `server/api/text-to-image/project-overlays/index.get.ts`
- Delete: `server/api/text-to-image/project-overlays/index.patch.ts`
- Delete: `server/api/text-to-image/project-overlays/project-overlay-api-contract.test.ts`
- Delete: `app/components/novel-ide/text-to-image/TextToImageProjectOverlayPanel.vue`
- Delete: `server/text-to-image/project-overlay-ui-contract.test.ts`
- Modify: `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`
- Modify: `server/agent/profiles/illustration-director-assets.test.ts`
- Create: `server/text-to-image/project-overlay-removal.test.ts`

**Interfaces:**

- Removed: all `ProjectOverlay*`, `StoryboardOverlay*`, `TagPatternOverlay*`,
  overlay codecs, overlay API routes, and overlay UI ownership.
- Preserved: `StoryboardPreset*`, `TagPatternSet*`, base hashes/review state,
  global selector/import/publish/default pair.

- [ ] **Step 1: Add the static removal gate before deleting files**

Create `project-overlay-removal.test.ts` with explicit production roots and exact
files. It must fail while any production owner remains:

```ts
const bannedTokens = [
    "ProjectOverlayService",
    "ProjectOverlayError",
    "ProjectOverlayEditorSnapshot",
    "STORYBOARD_OVERLAY_SCHEMA",
    "StoryboardOverlaySchema",
    "TAG_PATTERN_OVERLAY_SCHEMA",
    "TagPatternOverlaySchema",
    "throwProjectOverlayHttpError",
    "nbook/server/text-to-image/tag-pattern-resolver",
    "/api/text-to-image/project-overlays",
    "TextToImageProjectOverlayPanel",
];
```

Assert the known overlay files/routes/components do not exist. Also assert the
preserved global owners still exist and are referenced:

```ts
expect(snapshotService).toContain("readIllustrationDirectorSelectorSnapshot");
expect(snapshotService).toContain("ensureDefaultStoryboardPreset");
expect(storyboardPanel).toContain("TextToImageStoryboardImportPanel");
expect(storyboardPanel).not.toContain("@global-published");
expect(await pathExists("server/text-to-image/storyboard-publish.service.ts")).toBe(true);
```

Exclude `docs/**`, test fixtures, and historical task plans from token scans.

- [ ] **Step 2: Run the removal test and confirm RED**

Run:

```powershell
bunx vitest run server/text-to-image/project-overlay-removal.test.ts
```

Expected: FAIL and list the still-owned UI/API/schema/service paths.

- [ ] **Step 3: Remove overlay members from the base shared schemas**

From `text-to-image-storyboard-preset.ts`, remove only:

- `STORYBOARD_OVERLAY_SCHEMA`;
- overlay review and operation schemas;
- `StoryboardOverlaySchema` and type;
- `createStoryboardOverlaySemanticHash()`;
- `resolveStoryboardOverlayReviewState()`.

From `text-to-image-tag-pattern.ts`, remove only:

- `TAG_PATTERN_OVERLAY_SCHEMA`;
- overlay review and operation schemas;
- `TagPatternOverlaySchema` and type;
- `createTagPatternOverlayHashes()`;
- `resolveTagPatternOverlayReviewState()`.

Update the two shared tests by deleting overlay-only cases and imports. Keep all
base schema, approval/hash, policy and retrieval tests.

Narrow `TagPatternCandidateProvenanceSchema` and the server retrieval input to
`scope: "base"` / `operation: "base"`. Add a shared-schema regression proving
Project overlay provenance is no longer accepted.

- [ ] **Step 4: Delete the runtime, API, codec, resolver, and UI files**

Delete every file listed above. Do not issue a filesystem cleanup for historical
paths such as `.nbook/text-to-image/storyboard-overlays/**` or
`.nbook/text-to-image/tag-pattern-overlays/**`.

Remove the now-unreachable `ProjectOverlayError` handling from execution/workflow
HTTP mapping and workflow drift classification. Update the Tag Pattern retrieval
type and bundled companion test import so no surviving file imports a deleted
resolver or Project overlay owner.

In `NovelTextToImagePanel.vue`:

- remove the overlay component import;
- remove `projectOverlayRevision`;
- remove `handleGlobalStoryboardPublished()`;
- remove the `@global-published` listener;
- remove the overlay component;
- update comments to describe only Workflow, character generation/migration
  ownership remaining at that point, and global Storyboard import.

Do not remove `TextToImageStoryboardImportPanel`: global import/publish remains in
scope.

- [ ] **Step 5: Run schema, global infrastructure, and removal tests**

Run:

```powershell
bunx vitest run shared/text-to-image-storyboard-preset.test.ts shared/text-to-image-tag-pattern.test.ts shared/text-to-image-tag-pattern-retrieval.test.ts server/text-to-image/tag-pattern-retrieval.test.ts server/text-to-image/storyboard-companion.test.ts server/text-to-image/storyboard-planning-snapshot.service.test.ts server/text-to-image/storyboard-preset-init.test.ts server/text-to-image/storyboard-preset.codec.test.ts server/text-to-image/tag-pattern.codec.test.ts server/text-to-image/storyboard-publish.service.test.ts server/text-to-image/illustration-workflow.service.test.ts server/agent/profiles/illustration-director-assets.test.ts server/text-to-image/project-overlay-removal.test.ts
```

Expected: all listed files PASS. The removal test finds no production overlay
owner and proves global import/publish/default infrastructure still exists.

- [ ] **Step 6: Commit protocol removal**

Stage only the files listed in this task, then commit:

```powershell
git commit -m "refactor(text-to-image): remove project storyboard overlays"
```

---

### Task 4: Verify the overlay-free production graph

**Files:**

- Verify only; repository-level documentation is updated by the delivery-index
  plan after all vertical slices pass.

**Interfaces:**

- Consumes: Tasks 1–3.
- Produces: evidence that Planning and execution compile exclusively from the
  approved global companion.

- [ ] **Step 1: Run the focused regression suite**

Run:

```powershell
bunx vitest run server/text-to-image/storyboard-companion.test.ts server/text-to-image/storyboard-planning-snapshot.service.test.ts server/text-to-image/illustration-planning-input.builder.test.ts server/text-to-image/illustration-execution.compiler.test.ts server/text-to-image/illustration-compiler.test.ts server/text-to-image/storyboard-publish.service.test.ts server/text-to-image/storyboard-import.service.test.ts server/text-to-image/project-overlay-removal.test.ts
```

Expected: all listed files PASS.

- [ ] **Step 2: Run type checking**

Run outside the sandbox:

```powershell
bun run typecheck
```

Expected: no new diagnostics in the modified text-to-image files. If the repository
still has its documented vendored `llmlint` baseline, record it verbatim instead
of describing type checking as fully clean.

- [ ] **Step 3: Perform the final ownership scan**

Run:

```powershell
rg -n "ProjectOverlay|project-overlays|StoryboardOverlay|TagPatternOverlay|storyboard-overlay|tag-pattern-overlay" app shared server prisma --glob "!**/*.test.ts"
```

Expected: no matches.

Run:

```powershell
rg -n "readIllustrationDirectorSelectorSnapshot|ensureDefaultStoryboardPreset|StoryboardPlanningSnapshotService" server/text-to-image
```

Expected: the global snapshot/default/publish infrastructure remains, and both
Planning Input Builder and execution Compiler reference
`StoryboardPlanningSnapshotService`.
