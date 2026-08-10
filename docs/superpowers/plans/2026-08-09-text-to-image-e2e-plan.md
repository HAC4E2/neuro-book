# Task 142 Real Provider End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Complete and document the real-provider browser flow from current chapter text through LLM `<image>` output, local queue consumption, NovelAI generation, and Markdown image replacement.

**Architecture:** Reuse the existing Task 142 contract: the workbench backend reads the current chapter, the configured LLM returns image blocks, the editor stores prompt placeholders, the local Project queue composes the final NovelAI request, and the resulting asset replaces the placeholder with standard Markdown. The browser pass is the acceptance surface; code changes are allowed only when a reproducible failure violates the documented contract.

**Tech Stack:** Bun, Nuxt/Vue, Nitro API routes, Vitest, Project SQLite, TipTap, LLM-compatible HTTP Provider, NovelAI Provider.

> **Current status (2026-08-09):** 真实 LLM 已完成 L1 → L2 并写回 Project；Node 环境代理适配已使产品队列能访问 NovelAI，但两次正式请求均收到 `HTTP 429`，资产落盘与 Markdown 替换仍待上游限流解除。浏览器自动化会话不稳定，本轮 API/文件证据不替代浏览器人工验收。

## Global Constraints

- Use a real LLM/NovelAI Provider; a mock provider cannot be used as end-to-end evidence.
- Keep queue processing local to the Project; do not add Agent calls or cloud queue contracts.
- Send only the current chapter body to the body-image LLM; backend character scanning and prompt assembly remain authoritative.
- Keep global workbench configuration in Workspace Root `.nbook/config.json`; do not introduce localStorage as a second source of truth.
- Preserve the existing dirty worktree; do not reset, checkout, clean, or overwrite unrelated user changes.
- Do not expose or log API keys, credentials, session content, or generated private assets.
- Any production-code fix follows TDD: failing regression test first, then minimal implementation, then focused verification.

---

### Task 1: Establish the executable baseline

**Files:**
- Read: `docs/tasks/142-text-to-image-chatu8-port/README.md`
- Read: `docs/tasks/142-text-to-image-chatu8-port/BROWSER-WALKTHROUGH.md`
- Read: `task_plan.md`, `progress.md`, `findings.md`

**Interfaces:**
- Consumes: current Task 142 implementation and its recorded verification commands.
- Produces: a fresh local baseline and a list of browser steps still unchecked.

- [ ] **Step 1: Confirm the dirty-worktree boundary**

Run:

```powershell
git status --short --branch
git diff --check
```

Expected: the existing Task 142 changes remain untouched and `git diff --check` exits with code `0`.

- [ ] **Step 2: Run the focused automated baseline**

Run:

```powershell
bunx vitest run server/api/text-to-image server/text-to-image shared/text-to-image-markdown.test.ts app/components/novel-ide/text-to-image app/components/markdown-studio/markdown-studio-tool-availability.test.ts app/components/markdown-studio/load-monaco-editor.test.ts
bun run typecheck
```

Expected: the focused suite reports `159/159` assertions and typecheck exits with code `0`. If either command fails, stop browser acceptance and diagnose that failure first.

- [ ] **Step 3: Record the baseline without changing product code**

Record the command outputs and any environment limitation in `progress.md` only after the commands complete. Do not mark browser items complete from automated tests.

### Task 2: Start the local app and verify Provider prerequisites

**Files:**
- Read: `package.json`
- Read: `server/api/text-to-image/providers/index.get.ts`
- Read: `server/api/text-to-image/providers/index.post.ts`
- Read: `server/api/text-to-image/workbench/config.get.ts`
- Read: `server/api/text-to-image/workbench/config.put.ts`
- Modify only if a browser failure is reproduced: the smallest affected implementation file and its focused test.

**Interfaces:**
- Consumes: local dev command `bun run dev` and existing Provider/workbench APIs.
- Produces: a reachable local workbench with a real LLM-compatible Provider and NovelAI Provider available without leaking credentials.

- [ ] **Step 1: Start the development server**

Run the repository-defined command:

```powershell
bun run dev
```

Expected: the app reports a local HTTP URL. Keep the process alive for browser acceptance and use its terminal output only for non-sensitive errors.

- [ ] **Step 2: Open the workbench and verify the configured Providers**

In the browser, open the text-to-image workbench and confirm that the LLM and NovelAI Provider selectors are available. If no usable Provider exists, stop and report that real credentials/configuration are required; do not replace them with a mock.

- [ ] **Step 3: Verify persistence and local-auth behavior**

Create or select the real Providers, save them, refresh the page, and confirm the records remain available. In local no-auth mode, confirm saving does not produce the known foreign-key error. Do not inspect or copy the credential value.

### Task 3: Verify LLM-to-placeholder flow

**Files:**
- Read: `app/components/markdown-studio/MarkdownStudioToolbar.vue`
- Read: `app/components/markdown-studio/TipTapMarkdownEditor.vue`
- Read: `server/api/text-to-image/body-prompts.post.ts`
- Read: `server/text-to-image/body-session.service.ts`
- Read: `server/text-to-image/body-character-scanner.ts`
- Read: `server/text-to-image/body-prompt-compiler.ts`
- Read: `shared/text-to-image-markdown.ts`
- Modify only if a browser failure violates the current contract; add the regression test before implementation.

**Interfaces:**
- Consumes: current chapter Markdown, selected LLM/NovelAI Providers, and backend-resolved Project character groups.
- Produces: a valid LLM response containing `<image>` content and a TipTap prompt placeholder in the current chapter.

- [ ] **Step 1: Prepare a minimal real chapter fixture in the user’s Project**

Use a real current Project and a short chapter that contains one supported character trigger and one image-worthy scene. Do not alter unrelated chapters or commit generated private content.

- [ ] **Step 2: Invoke正文生图 from the Markdown Studio toolbar**

Select the real LLM and NovelAI Providers, invoke正文生图, and confirm the request uses the current chapter only. Confirm the response is rendered as an image prompt block rather than an unhandled error.

- [ ] **Step 3: Confirm placeholder insertion**

Write the generated prompt into the chapter and verify the TipTap card shows the prompt title and the `生成图片` action. Confirm the source text remains valid Markdown/TipTap content.

- [ ] **Step 4: If a contract failure occurs, add the failing test first**

Place the regression in the nearest existing suite, for example `server/api/text-to-image/body-prompts.post.test.ts`, `server/text-to-image/body-session.service.test.ts`, or `shared/text-to-image-markdown.test.ts`. Run only that test and confirm it fails for the reproduced behavior before touching production code.

### Task 4: Verify queue-to-NovelAI-to-Markdown flow

**Files:**
- Read: `app/components/novel-ide/text-to-image/TextToImageHistorySection.vue`
- Read: `app/components/novel-ide/text-to-image/TextToImageAssetActionDialog.vue`
- Read: `server/api/text-to-image/prompt-placeholders/[id]/generate.post.ts`
- Read: `server/api/text-to-image/queue/process.post.ts`
- Read: `server/text-to-image/queue.service.ts`
- Read: `server/text-to-image/queue.processor.ts`
- Read: `server/text-to-image/novelai-image-generation.ts`
- Read: `server/text-to-image/asset.service.ts`
- Read: `server/text-to-image/body-image-insert.service.ts`
- Modify only if a browser failure is reproduced and covered by a failing test.

**Interfaces:**
- Consumes: the placeholder created in Task 3 and a real NovelAI Provider.
- Produces: a persisted Project asset, a completed local Job, and a standard Markdown image replacing the placeholder.

- [ ] **Step 1: Generate the placeholder image**

Click `生成图片` once. Confirm the UI enters a running state, the local Job is consumed, and the request reaches the real NovelAI Provider without duplicate queue submission.

- [ ] **Step 2: Confirm the image replacement**

After completion, verify the TipTap placeholder is replaced by a Markdown image, the asset is readable from the Project Workspace, and the history page lists the generated asset with its source metadata.

- [ ] **Step 3: Verify the failure surface if generation fails**

If the real Provider rejects the request, record the sanitized HTTP status/error category, confirm the placeholder is not silently lost, and leave the Job/asset in the documented failure state. Never paste credentials or full request bodies into project files.

- [ ] **Step 4: Verify post-processing only after the base image succeeds**

Use the generated image’s long-press action for one tag edit or reroll only if the base image completed. Confirm the old asset remains and the new asset is returned, as required by the existing post-process contract.

### Task 5: Fix only reproducible gaps with TDD

**Files:**
- Modify: the smallest implementation file identified by the failing browser scenario.
- Test: the nearest existing focused test file for the same contract.
- Update: `docs/tasks/142-text-to-image-chatu8-port/BROWSER-WALKTHROUGH.md` only after the behavior is verified.

**Interfaces:**
- Consumes: one concrete browser failure and its sanitized reproduction details.
- Produces: a regression test, minimal fix, and green focused verification.

- [ ] **Step 1: Write one failing regression test**

The test must assert the user-visible contract, not an implementation detail, and must fail before the production change.

- [ ] **Step 2: Run the single test and verify the expected failure**

Run the exact Vitest file/test selector. If it errors because of test setup or typing rather than the reproduced contract, fix the test setup first and rerun until the failure is meaningful.

- [ ] **Step 3: Implement the minimal fix**

Change only the affected behavior. Preserve the current Project-root, local-queue, backend-character-scan, and credential-boundary contracts.

- [ ] **Step 4: Run focused green verification**

Run the changed test file, the Task 142 focused suite, `bun run typecheck`, and `git diff --check`. Expected: all pass with no new warnings except documented validation warnings and existing line-ending notices.

### Task 6: Close the acceptance record

**Files:**
- Modify: `docs/tasks/142-text-to-image-chatu8-port/BROWSER-WALKTHROUGH.md`
- Modify: `docs/tasks/142-text-to-image-chatu8-port/README.md` only if its summary conflicts with the detailed checklist.
- Modify: `progress.md` and `findings.md` with sanitized evidence.

**Interfaces:**
- Consumes: browser observations and command outputs from Tasks 1–5.
- Produces: an honest checklist distinguishing verified UI behavior, real-provider success, and remaining external blockers.

- [ ] **Step 1: Mark only directly observed browser items**

Mark a checkbox only when the exact user operation succeeded in the browser. Keep real-provider and credential-dependent items unchecked when not executed.

- [ ] **Step 2: Reconcile the summary with the detailed checklist**

Remove any claim that full browser acceptance is complete if the detailed checklist still contains unverified Provider, end-to-end, persistence, or console-error items.

- [ ] **Step 3: Run final verification**

Run:

```powershell
bunx vitest run server/api/text-to-image server/text-to-image shared/text-to-image-markdown.test.ts app/components/novel-ide/text-to-image app/components/markdown-studio/markdown-studio-tool-availability.test.ts app/components/markdown-studio/load-monaco-editor.test.ts
bun run typecheck
git diff --check
```

Expected: focused tests pass, typecheck exits with code `0`, and diff check exits with code `0`.

## Self-review

- Scope is limited to Task 142’s real-provider acceptance and defects revealed by that acceptance; P5 remains out of scope.
- No step authorizes mock-provider evidence, secret inspection, destructive Git operations, or unrelated refactors.
- The plan distinguishes automated tests from browser and real-model evidence, matching the repository’s verification contract.
- Any production-code change has an explicit failing-test gate in Task 5.

## Latest verification update

- The product generation request was retried on `HTTP 429` with a `15s` interval; the next loop attempt succeeded immediately.
- Job `d541d2b3-a4ba-4169-b316-8deea06e9d3d` reached `succeeded`; asset `assets/tti/fd408d31-866a-4f2c-96f1-e1f1f1e35c8f.png` was saved at `1216x832` and `2,235,299` bytes.
- The current `ce-shi` chapter was updated through the CAS workspace write endpoint and now contains the standard Markdown image without the prompt placeholder.
- Browser manual acceptance remains unchecked; this pass provides API, queue, asset, file, and visual evidence only.
