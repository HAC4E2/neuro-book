# Illustration Director Binding and Windows Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the only editable `illustration.director` model binding in Global Model Settings and make the Windows EXE version derive from the same application version.

**Architecture:** Extend the existing model-settings draft so the Director model key is loaded, validated, renamed, protected during Provider deletion, and persisted atomically with Provider/model changes. Render the existing small Director card in the Global Model Settings panel; it remains absent from Project settings and Agent Profile settings. Synchronize package and Tauri versions so Windows resource metadata no longer stays at `0.4.2`.

**Tech Stack:** Vue 3, TypeScript, Vitest, Nuxt/Nitro, Tauri 2, Bun.

## Global Constraints

- `illustration.director` is configured only through Global Model Settings.
- Project settings and Agent Profile settings must not create a second writable binding.
- Provider/model edits and Director selection save atomically through Global Config.
- Final Windows Portable output remains `dist/neuro-book-desktop-x64`.

---

### Task 1: Restore Director binding state and persistence

**Files:**

- Modify: `app/components/novel-ide/settings/model-settings-draft.ts`
- Modify: `app/components/novel-ide/settings/useModelSettingsDraftSession.ts`
- Test: `app/components/novel-ide/settings/useModelSettingsDraftSession.test.ts`

- [ ] **Step 1: Write the failing test**

Add a Global snapshot fixture with `modelSettings.illustrationDirector.modelKey = "openai/gpt-5"`, then assert that the draft exposes that key and the Global save payload writes it to `agent.profiles["illustration.director"].model.modelKey`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run app/components/novel-ide/settings/useModelSettingsDraftSession.test.ts`

Expected: FAIL because the extracted draft session has no Director field or persistence path.

- [ ] **Step 3: Write minimal implementation**

Add `illustrationDirectorModelKey: string | null` to `ModelSettingsDraft`. Load it from the Global snapshot, include it in dirty state, keep it synchronized when a Provider ID is renamed, reject deletion of its referenced Provider, and write it into Global Config using `ILLUSTRATION_DIRECTOR_PROFILE_KEY` and `cleanModelKey`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run app/components/novel-ide/settings/useModelSettingsDraftSession.test.ts`

Expected: PASS.

### Task 2: Render and focus the Global Director card

**Files:**

- Modify: `app/components/novel-ide/settings/NovelIdeModelSettingsPanel.vue`
- Test: `server/config/settings-security-contract.test.ts`

- [ ] **Step 1: Write the failing test**

Assert that the Model Settings panel source contains `illustration-director-model-binding` and binds `draft.illustrationDirectorModelKey`; retain the existing assertion that Agent Profile settings protect the Director binding.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run server/config/settings-security-contract.test.ts`

Expected: FAIL because the refactored Model Settings panel contains neither the card nor its model selector.

- [ ] **Step 3: Write minimal implementation**

Add a Global-only card above the Provider editor. It uses `NovelIdeModelSelect` with current runnable options, supports clearing the binding, identifies the current Provider/model, and its “edit connection” action selects that Provider. The card exposes `id="illustration-director-model-binding"` so the existing text-to-image navigation can focus it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run server/config/settings-security-contract.test.ts app/components/novel-ide/settings/useModelSettingsDraftSession.test.ts`

Expected: PASS.

### Task 3: Synchronize Windows EXE version and package

**Files:**

- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Test: `scripts/deploy/tauri-portable.test.ts` or a focused new version-contract test

- [ ] **Step 1: Write the failing test**

Assert that package, Tauri config, and Cargo manifest contain the same SemVer version and that it is not `0.4.2`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run scripts/deploy/tauri-portable.test.ts`

Expected: FAIL because Tauri config and Cargo currently report `0.4.2` while package reports a different version.

- [ ] **Step 3: Write minimal implementation**

Set one new local canary SemVer in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`; do not alter release scripts or create a public release.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run scripts/deploy/tauri-portable.test.ts`

Expected: PASS.

### Task 4: Build, package, and verify the final Portable

**Files:**

- Modify: `RELEASE.md`
- Modify: `docs/tasks/104-pi-models-runtime-upgrade/README.md`

- [ ] **Step 1: Run focused regressions and typecheck**

Run: `bunx vitest run server/config/settings-security-contract.test.ts app/components/novel-ide/settings/useModelSettingsDraftSession.test.ts scripts/deploy/tauri-portable.test.ts` then `bun run typecheck`.

- [ ] **Step 2: Build Portable in release order**

Run: `bun run nuxt:build`, `bun run product:stage`, the existing Tauri release command, then the existing Portable assemble command.

- [ ] **Step 3: Verify output**

Read the final EXE `VersionInfo.FileVersion` and `ProductVersion`, check `dist/neuro-book-desktop-x64/NeuroBook.exe` exists, and confirm the compiled model-settings client bundle contains `illustration-director-model-binding`.

- [ ] **Step 4: Record actual results**

Update the release note and Task 104 walkthrough with test counts, build exit codes, chosen version, and EXE metadata.
