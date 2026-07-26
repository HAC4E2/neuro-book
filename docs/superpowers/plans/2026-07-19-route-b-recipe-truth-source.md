# Route B Recipe Truth Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Project Recipe Markdown the sole persisted owner of NovelAI generation parameters and style, make manual Jobs compile from a server-side RecipeSnapshot, and establish the first-stage singleton Provider preflight boundary.

**Architecture:** A strict shared Recipe schema is encoded into one standard Project Workspace instruction content node. A Project-scoped service owns canonical parse/render/hash and tracked writes. The browser holds only a loaded draft; manual generation submits user prompt/count and references, while the server resolves the Provider and Recipe and freezes the execution snapshot.

**Tech Stack:** TypeScript, Zod, YAML, Nuxt/Nitro, Vue 3, Pinia, Prisma SQLite, Vitest.

## Global Constraints

- `illustration.director` binding remains owned by Global Config and is read-only in the text-to-image page.
- NovelAI API and Recipe editing remain exclusively in the text-to-image page.
- No TTP (text-to-picture) `tagData` access or conversion.
- No localStorage/Pinia persisted Recipe mirror.
- No compatibility adapter that reopens the old body-image chain.
- No browser verification, commit, push, or release without explicit user authorization.

---

### Task 1: Strict Recipe source and snapshot codec

**Files:**
- Create: `shared/text-to-image-recipe.ts`
- Create: `server/text-to-image/recipe.codec.ts`
- Test: `server/text-to-image/recipe.codec.test.ts`

**Interfaces:**
- Produces `TextToImageRecipeSource`, `TextToImageRecipeSnapshot`, `TextToImageRecipeSourceSchema`, `parseTextToImageRecipeMarkdown()`, and `renderTextToImageRecipeMarkdown()`.
- `planningConstraintsHash` covers only canvas/size planning constraints; `recipeSourceHash` covers the full normalized Recipe source.

- [x] Write tests for strict unknown-key rejection, canonical round-trip, duplicate/invalid frontmatter rejection, and stable/separated hashes.
- [x] Run the codec test and confirm RED because the module does not exist.
- [x] Implement schema, canonical renderer, parser, and SHA-256 hashes.
- [x] Run the codec test and confirm GREEN.

### Task 2: Project Recipe service and API

**Files:**
- Create: `server/text-to-image/recipe.service.ts`
- Create: `server/text-to-image/recipe.service.test.ts`
- Create: `server/api/text-to-image/recipes/default.get.ts`
- Create: `server/api/text-to-image/recipes/default.put.ts`

**Interfaces:**
- `read(projectPath)` returns `{exists, source, snapshot}` and never writes defaults.
- `save({projectPath, source, expectedRecipeSourceHash})` uses Project lifecycle guard, optimistic hash validation, tracked write, and Project index invalidation.
- GET is read-only; PUT is the sole Recipe writer exposed to the text-to-image page.

- [x] Write service RED tests for missing default, canonical save/read, conflict, invalid Project path, and history-aware writer injection.
- [x] Implement injectable Project file dependencies and stable HTTP error mapping.
- [x] Add strict GET/PUT handlers with `requireCurrentUser` and Project lifecycle enforcement.
- [x] Run service/API-focused tests and confirm GREEN.

### Task 3: Manual Job server compilation

**Files:**
- Modify: `server/text-to-image/schemas.ts`
- Modify: `server/text-to-image/schemas.test.ts`
- Modify: `server/api/text-to-image/jobs/index.post.ts`
- Modify: `server/text-to-image/queue.service.ts`
- Modify: `server/text-to-image/queue.service.test.ts`
- Modify: `server/text-to-image/novelai-image-generation.ts`
- Modify: `server/text-to-image/novelai-image-generation.test.ts`

**Interfaces:**
- HTTP manual Job body accepts `projectPath`, `providerId`, `kind=manual`, user prompt/negative prompt, count, recipe id/hash; it rejects `novelAi`, model, sampler, seed, size, style, and Recipe body.
- Queue input persists `recipeSnapshot`, `recipeSourceHash`, and the server-compiled NovelAI settings; Provider resolution no longer overrides the Recipe model.

- [x] Write RED tests proving front-end NovelAI scalars are rejected and Provider.model cannot override Recipe.model.
- [x] Compile manual request from the current RecipeSnapshot in the POST handler/service.
- [x] Pass Recipe style/quality/basic advanced fields through the controlled NovelAI request builder without Data URLs.
- [x] Run schema/queue/generation tests and confirm GREEN.

### Task 4: Browser draft hard cut and Recipe UI

**Files:**
- Create: `app/utils/text-to-image-recipe-migration.ts`
- Create: `app/utils/text-to-image-recipe-migration.test.ts`
- Modify: `app/stores/text-to-image.ts`
- Modify: `app/stores/text-to-image.test.ts`
- Modify: `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`
- Modify: `server/config/settings-security-contract.test.ts`

**Interfaces:**
- Store loads Recipe into an in-memory draft and saves through the Recipe API; persistedstate no longer picks `novelAi`, `stylePresets`, or `activeStyleId`.
- A migration-only parser may read the old `text.to.image` value once when no Recipe exists, but never writes it as runtime truth; successful Recipe save removes only the migrated keys.
- UI shows unsaved/migration/conflict state and requires explicit Save.

- [x] Write RED tests for persistence removal, migration-only parsing/cleanup, and API ownership markers.
- [x] Implement store load/apply/build helpers and remove Recipe fields from persisted pick.
- [x] Add load/save/error/migration notice to the text-to-image page; retain local error state for recoverable form failures.
- [x] Change manual generation payload to references only.
- [x] Run store/UI contract tests and confirm GREEN.

### Task 5: NovelAI singleton preflight boundary

**Files:**
- Modify: `shared/dto/text-to-image.dto.ts`
- Modify: `server/text-to-image/provider.service.ts`
- Modify: `server/text-to-image/provider.service.test.ts`
- Modify: `server/text-to-image/schemas.ts`
- Modify: `server/api/text-to-image/providers/index.post.ts`
- Create: `server/api/text-to-image/providers/novelai.get.ts`
- Create: `server/api/text-to-image/providers/novelai.put.ts`
- Create: `server/api/text-to-image/providers/novelai/test.post.ts`

**Interfaces:**
- `inspectNovelAi(ownerUserId)` returns `unconfigured | configured | selection_required` and secret-free candidates.
- Collection POST rejects `kind=novelai`; formal singleton PUT only creates when zero records, updates the same id when one exists, and returns `TEXT_TO_IMAGE_PROVIDER_SELECTION_REQUIRED` when duplicates exist.
- This task deliberately does not add the partial unique index; the next migration task does so only after explicit duplicate reconciliation is complete.

- [x] Write RED tests for 0/1/many inspection, same-id upsert, duplicate fail-closed, and collection POST rejection.
- [x] Implement service/store methods and strict singleton DTOs.
- [x] Add formal singleton routes and connection-test error handling.
- [x] Run provider tests and confirm GREEN.

### Task 6: Verification and documentation

**Files:**
- Modify: `docs/tasks/text-to-image-panel/README.md`
- Modify: `PROJECT-STATUS.md` only if architecture/status changed.
- Modify: `.planning/2026-07-19-route-b-recipe-truth-source/*`

- [x] Run the complete focused Recipe/Provider/Job suite.
- [x] Run `bun run typecheck` outside the sandbox.
- [x] Request an independent code review and address P0/P1 findings.
- [x] Update actual results, deviations, remaining singleton migration/lane work, and verification evidence.
