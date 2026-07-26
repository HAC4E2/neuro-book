# NeuroBook 文生图系统完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 系统修复现有文生图问题 1-9，并把生成资产改为 Project 级服务端真相源和独立历史图片工作区。

**Architecture:** App SQLite 保存按用户隔离且加密的 Provider 配置，Project SQLite 保存任务与资产元数据，图片文件固定保存为 Project-relative 资产。正文链路由一次性角色识别/Resolver Agent、确定性 Prompt Compiler、服务端队列和带章节哈希校验的写回服务组成，最终正文只保留标准 Markdown 图片。

**Tech Stack:** Nuxt 4、Vue 3、Pinia、Nitro/H3、Prisma 7 + SQLite/libSQL、Zod 4、Vitest、TipTap 3、Node.js `crypto`/`fs`。

## Global Constraints

- Prompt Resolver 自动插入阈值固定为 `0.65`。
- LLM 请求默认超时 `120000ms`；NovelAI 请求默认超时 `300000ms`。
- 只重试网络错误、HTTP 429 和 HTTP 5xx；最多重试 `2` 次并指数退避；其他 4xx 不重试。
- 同一 Provider 串行执行，请求间隔默认 `15000ms`。
- 图片固定保存到 `assets/text-to-image/YYYY/MM/<asset-id>.<ext>`，数据库和 Markdown 不保存服务器绝对路径或 base64。
- Project 数据面必须经过 ProjectSession 守卫；正文和角色 Markdown 写入必须进入 Workspace History。
- Provider 凭据不返回前端、不写 Pinia/localStorage、不进入日志、Project 导出或任务 `requestJson`。
- 旧 `<text-to-image-result>`、旧角色/服装 Pinia 状态和旧浏览器队列直接删除，不增加兼容层。
- 不修改正文世界书的 `<image>...</image>` 输出合同。
- 不新增依赖；使用仓库现有 Prisma、Zod、Vitest、TipTap 和 Node 标准库。
- 不自动运行浏览器验证；不创建 git commit，除非用户另行明确要求。

---

## File Map

### Shared contracts

- Create `shared/dto/text-to-image.dto.ts`: Provider、Job、Asset、Resolver、分页与命令 DTO 的唯一前后端合同。
- Create `server/text-to-image/schemas.ts`: HTTP 输入和持久化 JSON 的 Zod schema，输出 DTO 由显式 mapper 生成。

### App-level provider boundary

- Modify `prisma/schema.sqlite.prisma` and `prisma/schema.prisma`: 新增 `TextToImageProvider` 及 `User.providers` 关系。
- Create `prisma/migrations/sqlite/20260710120000_text_to_image_providers/migration.sql`: App SQLite provider 表和索引。
- Create `server/text-to-image/provider-url-policy.ts`: URL 协议、凭据、fragment 和私网策略。
- Create `server/text-to-image/provider-credential.ts`: AES-256-GCM 主密钥和凭据封装。
- Create `server/text-to-image/provider.service.ts`: Provider CRUD、所有权检查、凭据解析和 DTO 脱敏。
- Create provider routes under `server/api/text-to-image/providers/`.

### Project-level persistence and runtime

- Modify `prisma/project.schema.prisma`: 新增 `TextToImageJob`、`TextToImageAsset` 及枚举。
- Modify `server/workspace-files/project-workspace.ts`: 新库建表与旧 Project 幂等迁移。
- Create `server/text-to-image/project-client.ts`: Project PrismaClient 缓存和 ProjectSession 资源释放。
- Create `server/text-to-image/asset.service.ts`: 资产原子写入、读取、分页、引用扫描和受保护删除。
- Create `server/text-to-image/queue.service.ts`: 持久任务状态机、Provider 串行调度、超时、重试和取消。
- Refactor `server/text-to-image/novelai-image-generation.ts`: 只负责构建受控 NovelAI 请求并返回图片字节，不选择任意目录。
- Replace old generation/image/output-directory routes with jobs/assets APIs.

### Prompt and chapter chain

- Replace `server/text-to-image/body-image-prompt-placement.ts` with `server/text-to-image/body-image-prompt-resolver.ts`.
- Create `server/text-to-image/prompt-compiler.ts`: `image-tags.md` 的确定性纯函数编译器。
- Create `server/text-to-image/chapter.service.ts`: 章节快照、哈希冲突、占位符和 Markdown 图片写回。
- Modify `server/text-to-image/body-image-character-tags.ts`: 一次性 Agent session、候选 ID 约束和别名边界匹配。
- Create `server/api/text-to-image/body-prompts.post.ts`: 正文 LLM、Resolver、Compiler 和占位符写入编排。
- Replace prompt placement profile/skill with prompt resolver profile/skill and regenerate compiled assets.

### Character tag generation

- Modify `app/utils/text-to-image-character-tags.ts`: 固定 schema、字段级 merge 和 Markdown 往返合同。
- Modify `server/text-to-image/character-image-tags.ts` and its route: Provider ID、固定 system contract、Zod 校验、tracked write。
- Modify `app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue`: 默认补空和“重新生成全部视觉字段”确认入口。

### Frontend and editor

- Rewrite `app/stores/text-to-image.ts`: 仅保留非敏感设置、画风、词库、替换规则、草稿和服务端队列摘要。
- Delete `app/utils/text-to-image-generation-queue.ts` and old tests.
- Split `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue` into focused configuration components.
- Create `app/components/novel-ide/text-to-image/TextToImageHistoryWorkspace.vue` and asset detail dialog.
- Modify `app/stores/novel-ide.ts` and `app/pages/index.vue`: 新增单例 `text-to-image-history` tab，移除旧 character tab。
- Modify `app/components/markdown-studio/tiptap/TextToImagePrompt.ts`: 结构化待生成 payload。
- Delete `app/components/markdown-studio/tiptap/TextToImageResult.ts`; use standard TipTap Image serialization and controlled asset content URL mapping.
- Modify `app/utils/text-to-image-llm.ts`: 去掉旧 result JSON，保留 `<image>` 解析和标准 Markdown helper。

### Documentation

- Update `docs/tasks/text-to-image-panel/README.md`, `PROJECT-STATUS.md`, `task_plan.md`, `findings.md`, and `progress.md` with actual implementation and verification results.

---

### Task 1: Establish Provider Security Boundary

**Files:**
- Create: `shared/dto/text-to-image.dto.ts`
- Create: `server/text-to-image/schemas.ts`
- Modify: `prisma/schema.sqlite.prisma`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/sqlite/20260710120000_text_to_image_providers/migration.sql`
- Create: `server/text-to-image/provider-url-policy.ts`
- Create: `server/text-to-image/provider-url-policy.test.ts`
- Create: `server/text-to-image/provider-credential.ts`
- Create: `server/text-to-image/provider-credential.test.ts`
- Create: `server/text-to-image/provider.service.ts`
- Create: `server/text-to-image/provider.service.test.ts`
- Create: `server/api/text-to-image/providers/index.get.ts`
- Create: `server/api/text-to-image/providers/index.post.ts`
- Create: `server/api/text-to-image/providers/[id].patch.ts`
- Create: `server/api/text-to-image/providers/[id].delete.ts`
- Create: `server/api/text-to-image/providers/[id]/models.get.ts`

**Interfaces:**
- Produces: `TextToImageProviderDto`, `TextToImageProviderInput`, `TextToImageProviderService.resolveCredential(ownerUserId, providerId)`.
- Security invariant: DTO mapper returns `hasCredential` only; credential columns never cross the service boundary.

- [ ] **Step 1: Write failing URL-policy and credential tests**

```typescript
expect(() => assertTextToImageProviderUrl("file:///etc/passwd", {allowPrivateNetwork: false})).toThrow();
expect(() => assertTextToImageProviderUrl("https://user:pass@example.com/v1#secret", {allowPrivateNetwork: false})).toThrow();
expect(() => assertTextToImageProviderUrl("http://127.0.0.1:11434/v1", {allowPrivateNetwork: false})).toThrow();
const sealed = await sealTextToImageCredential("secret-token", keyPath);
expect(await openTextToImageCredential(sealed, keyPath)).toBe("secret-token");
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `bunx vitest run server/text-to-image/provider-url-policy.test.ts server/text-to-image/provider-credential.test.ts server/text-to-image/provider.service.test.ts`

Expected: FAIL because the provider modules and Prisma model do not exist.

- [ ] **Step 3: Add the shared DTO and App SQLite schema**

```typescript
export type TextToImageProviderKind = "novelai" | "openai_compatible";
export type TextToImageProviderDto = {
    id: number;
    kind: TextToImageProviderKind;
    name: string;
    baseUrl: string;
    model: string;
    settings: {allowPrivateNetwork: boolean; requestIntervalMs: number};
    hasCredential: boolean;
    createdAt: string;
    updatedAt: string;
};
```

The migration creates a foreign key to `User(id)`, a unique `(ownerUserId, name)` index, and an `(ownerUserId, kind)` index.

- [ ] **Step 4: Implement AES-256-GCM credentials and centralized URL policy**

```typescript
export type SealedCredential = {ciphertext: string; iv: string; tag: string};
export async function sealTextToImageCredential(value: string, keyPath?: string): Promise<SealedCredential>;
export async function openTextToImageCredential(value: SealedCredential, keyPath?: string): Promise<string>;
export function assertTextToImageProviderUrl(value: string, policy: {allowPrivateNetwork: boolean}): URL;
```

Store the 32-byte master key at `workspace/.nbook/secrets/text-to-image.key`; create it atomically and request mode `0o600` where supported.

- [ ] **Step 5: Implement owner-scoped Provider service and routes**

Every route calls `requireCurrentUser(event)`. `novelai` ignores user-provided `baseUrl` and resolves the fixed official image endpoint; `openai_compatible` is validated on save and again before use. PATCH preserves the prior credential when `credential` is omitted.

- [ ] **Step 6: Remove arbitrary LLM credential request bodies**

Modify `server/text-to-image/llm-provider.ts`, `server/api/text-to-image/llm-models.post.ts`, and `server/api/text-to-image/llm-completion.post.ts` so their public input is `{providerId, ...nonSensitiveParameters}` and the server resolves URL/model/credential by current user.

- [ ] **Step 7: Generate Prisma clients and verify GREEN**

Run: `bun run generate`

Run: `bunx vitest run server/text-to-image/provider-url-policy.test.ts server/text-to-image/provider-credential.test.ts server/text-to-image/provider.service.test.ts server/text-to-image/llm-provider.test.ts`

Expected: all focused tests PASS and generated App Prisma types include `TextToImageProvider`.

### Task 2: Add Project Job and Asset Persistence

**Files:**
- Modify: `prisma/project.schema.prisma`
- Modify: `server/workspace-files/project-workspace.ts`
- Modify: `server/workspace-files/project-workspace.test.ts`
- Create: `server/text-to-image/project-client.ts`
- Create: `server/text-to-image/project-client.test.ts`
- Create: `server/text-to-image/asset-path.ts`
- Create: `server/text-to-image/asset-path.test.ts`
- Create: `server/text-to-image/asset.service.ts`
- Create: `server/text-to-image/asset.service.test.ts`

**Interfaces:**
- Produces: `textToImageProjectClient(projectPath)`, `TextToImageAssetService.save/list/content/delete`.
- Consumes: ProjectSession `assertProjectOpen`, `registerProjectResourceOwner`; Project path resolution from `project-workspace.ts`.

- [ ] **Step 1: Write failing Project migration and path-containment tests**

```typescript
expect(resolveTextToImageAssetPath(projectRoot, "assets/text-to-image/2026/07/a.png"))
    .toBe(path.join(projectRoot, "assets", "text-to-image", "2026", "07", "a.png"));
expect(() => resolveTextToImageAssetPath(projectRoot, "../outside.png")).toThrow();
expect(await tableNames(projectDatabase)).toContain("TextToImageAsset");
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bunx vitest run server/workspace-files/project-workspace.test.ts server/text-to-image/asset-path.test.ts server/text-to-image/asset.service.test.ts`

Expected: FAIL because the models, migration SQL and service do not exist.

- [ ] **Step 3: Add Project Prisma models and idempotent SQL**

Use string IDs generated before file creation so the filename and DB identity are the same. Every asset belongs to an already-persisted job, so `TextToImageAsset.jobId` is required; `TextToImageJob.resultAssetIdsJson` defaults to `"[]"`; `TextToImageJob.sourceInsertStatus` is `not_applicable | pending | inserted | missing` and defaults to `not_applicable`. Add indexes for `(status, createdAt)`, `(providerId, status, createdAt)`, `(sourcePath, createdAt)`, and unique `relativePath`.

- [ ] **Step 4: Implement Project client ownership**

```typescript
export async function textToImageProjectClient(projectPath: string): Promise<PrismaClient>;
export async function closeTextToImageProjectClient(projectPath: string): Promise<void>;
```

The module asserts the Project is open, marks activity, caches one client per normalized Project, and registers a `text-to-image-project-client` resource owner for close/closeAll.

- [ ] **Step 5: Implement atomic asset service**

```typescript
export class TextToImageAssetService {
    async save(input: SaveTextToImageAssetInput): Promise<TextToImageAssetDto>;
    async list(input: ListTextToImageAssetsInput): Promise<TextToImageAssetPageDto>;
    async content(projectPath: string, assetId: string): Promise<{absolutePath: string; mimeType: string}>;
    async delete(projectPath: string, assetId: string): Promise<void>;
}
```

`save` writes `<asset-id>.tmp`, fsyncs where available, renames to final path, then inserts DB metadata; DB failure removes the final file. `delete` scans authored `*.md` under the Project root while excluding `.nbook/**`; a live relative-path reference raises stable code `TEXT_TO_IMAGE_ASSET_REFERENCED` before any delete.

- [ ] **Step 6: Verify migration, compensation and lifecycle tests GREEN**

Run: `bun run generate`

Run: `bunx vitest run server/workspace-files/project-workspace.test.ts server/text-to-image/project-client.test.ts server/text-to-image/asset-path.test.ts server/text-to-image/asset.service.test.ts`

Expected: all focused tests PASS, including unopened Project rejection and file/DB compensation.

### Task 3: Move Generation to a Persistent Server Queue

**Files:**
- Modify: `server/text-to-image/novelai-image-generation.ts`
- Modify: `server/text-to-image/novelai-image-generation.test.ts`
- Create: `server/text-to-image/queue.service.ts`
- Create: `server/text-to-image/queue.service.test.ts`
- Create: `server/api/text-to-image/jobs/index.post.ts`
- Create: `server/api/text-to-image/jobs/index.get.ts`
- Create: `server/api/text-to-image/jobs/[id]/cancel.post.ts`
- Create: `server/api/text-to-image/jobs/[id]/retry.post.ts`
- Create: `server/api/text-to-image/assets/index.get.ts`
- Create: `server/api/text-to-image/assets/[id]/content.get.ts`
- Create: `server/api/text-to-image/assets/[id].delete.ts`
- Delete: `server/api/text-to-image/generate.post.ts`
- Delete: `server/api/text-to-image/image.get.ts`
- Delete: `server/api/text-to-image/select-output-directory.post.ts`

**Interfaces:**
- Consumes: Provider service, Project client and asset service.
- Produces: `TextToImageQueueService.enqueue/list/cancel/retry/recoverProject`, jobs/assets HTTP API.

- [ ] **Step 1: Write the queue state-machine tests**

```typescript
expect(await queue.enqueue(input)).toMatchObject({status: "queued", attemptCount: 0});
await queue.drainProvider(projectPath, providerId);
expect(await job(jobId)).toMatchObject({status: "succeeded", attemptCount: 1});
expect(maxConcurrentRequestsForProvider).toBe(1);
```

Cover retryable network/429/5xx failures, non-retryable 400, cancellation of queued/running jobs, `running -> interrupted` recovery, and redaction of credentials/data URLs from `requestJson`.

- [ ] **Step 2: Run queue tests and verify RED**

Run: `bunx vitest run server/text-to-image/novelai-image-generation.test.ts server/text-to-image/queue.service.test.ts`

Expected: FAIL because the queue service does not exist and the old generator still writes arbitrary paths.

- [ ] **Step 3: Refactor the NovelAI client boundary**

```typescript
export type NovelAiGeneratedImage = {bytes: Uint8Array; mimeType: "image/png"; width: number; height: number; seed: number};
export async function requestNovelAiImages(input: NovelAiRequestInput, signal: AbortSignal): Promise<NovelAiGeneratedImage[]>;
```

The function receives a server-resolved credential and fixed URL, never `outputDirectory`, `token`, `imageBaseUrl`, or an absolute path from the request body.

- [ ] **Step 4: Implement queue dispatch and recovery**

Use one in-process lane per `(projectPath, providerId)`. Persist state before scheduling, use `AbortSignal.timeout` combined with the user cancel controller, wait the configured interval between starts, and cap retry attempts at three total executions (initial plus two retries).

Before persisting a job, decode vibe/character reference data URLs into contained runtime files under `.nbook/text-to-image/job-inputs/<job-id>/` and persist only those Project-internal references. This keeps queued jobs restartable without putting data URLs or credentials in `requestJson`; terminal jobs clean their runtime input directory.

- [ ] **Step 5: Implement guarded jobs/assets APIs**

All routes validate with Zod, call `assertProjectOpenForRoot(projectPath)`, and map stable domain errors to H3 status/data. Asset content resolves by `projectPath + assetId`; no route accepts an absolute path.

- [ ] **Step 6: Verify queue and API contracts GREEN**

Run: `bunx vitest run server/text-to-image/novelai-image-generation.test.ts server/text-to-image/queue.service.test.ts server/api/text-to-image`

Expected: focused tests PASS; repository search finds no text-to-image API query/body field named `outputDirectory`, `imageBaseUrl`, `apiKey`, or `token`.

### Task 4: Replace Prompt Placement with Resolution and Deterministic Compilation

**Files:**
- Create: `server/text-to-image/body-image-prompt-resolver.ts`
- Create: `server/text-to-image/body-image-prompt-resolver.test.ts`
- Delete: `server/text-to-image/body-image-prompt-placement.ts`
- Delete: `server/text-to-image/body-image-prompt-placement.test.ts`
- Create: `server/text-to-image/prompt-compiler.ts`
- Create: `server/text-to-image/prompt-compiler.test.ts`
- Modify: `server/text-to-image/body-image-character-tags.ts`
- Modify: `server/text-to-image/body-image-character-tags.test.ts`
- Create: `assets/workspace/.nbook/agent/profiles/builtin/body-image.prompt-resolver.profile.tsx`
- Create: `assets/workspace/.nbook/agent/skills/body-image-prompt-resolver/SKILL.md`
- Delete: `assets/workspace/.nbook/agent/profiles/builtin/body-image.prompt-placer.profile.tsx`
- Delete: `assets/workspace/.nbook/agent/skills/body-image-prompt-placement/SKILL.md`
- Modify: `server/agent/profiles/builtin-contracts.ts`
- Replace: `server/agent/profiles/body-image-prompt-placer-profile.test.ts` with `server/agent/profiles/body-image-prompt-resolver-profile.test.ts`

**Interfaces:**
- Produces: `resolveBodyImagePrompts(input): Promise<BodyImagePromptResolution[]>` and `compileTextToImagePrompt(input): CompiledTextToImagePrompt`.
- Resolution enums: `view`, `framing`, `rating`; unknown IDs are rejected and confidence below `0.65` is filtered.

- [ ] **Step 1: Write failing resolver normalization and compiler matrix tests**

```typescript
const result = compileTextToImagePrompt({
    basePrompt: "girl by window",
    baseNegativePrompt: "bad hands",
    resolution: {view: "back", framing: "full", rating: "sfw", outfitName: "深色水手校服"},
    characters: [characterTag],
    promptRules,
});
expect(result.prompt).toContain(characterTag.faceBack);
expect(result.prompt).toContain(characterTag.upperBackSfw);
expect(result.prompt).toContain(characterTag.lowerBackSfw);
expect(result.negativePrompt).toContain(characterTag.negativePrompt);
expect(result.prompt).not.toContain(characterTag.upperFrontNsfw);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bunx vitest run server/text-to-image/body-image-prompt-resolver.test.ts server/text-to-image/prompt-compiler.test.ts server/text-to-image/body-image-character-tags.test.ts`

Expected: FAIL because the resolver and compiler do not exist.

- [ ] **Step 3: Implement strict resolver normalization**

```typescript
export type BodyImagePromptResolution = {
    promptId: string;
    afterParagraphId: string;
    characterIds: string[];
    view: "front" | "back";
    framing: "face" | "upper" | "lower" | "full";
    rating: "sfw" | "nsfw";
    outfitName: string;
    reason: string;
    confidence: number;
};
```

Only IDs supplied in the current request survive normalization. Pass only paragraph arrays, prompt arrays and compact candidate character metadata to a fresh Agent session; archive it after the call.

- [ ] **Step 4: Implement the pure compiler**

Normalize comma-separated tags, preserve weighted NovelAI syntax, dedupe exact normalized terms in stable order, resolve an outfit only from the selected character's declared Chinese/English outfit rows, merge per-character negatives, then apply enabled replacement rules exactly once.

- [ ] **Step 5: Harden character detection fallback**

Ignore aliases shorter than two Han characters unless surrounded by explicit non-word boundaries. Agent output remains a subset of candidate IDs and every invocation uses a fresh archived session.

- [ ] **Step 6: Compile the renamed profile and verify GREEN**

Run: `bun scripts/build/profile.ts compile builtin/body-image.prompt-resolver.profile.tsx --system`

Run: `bunx vitest run server/text-to-image/body-image-prompt-resolver.test.ts server/text-to-image/prompt-compiler.test.ts server/text-to-image/body-image-character-tags.test.ts server/agent/profiles/body-image-prompt-resolver-profile.test.ts`

Expected: all focused tests PASS and the compiled manifest contains `body-image.prompt-resolver`, not `body-image.prompt-placer`.

### Task 5: Make Chapter Writes Versioned and Emit Standard Markdown Images

**Files:**
- Create: `server/text-to-image/chapter.service.ts`
- Create: `server/text-to-image/chapter.service.test.ts`
- Create: `server/api/text-to-image/body-prompts.post.ts`
- Create: `server/api/text-to-image/body-prompts.post.test.ts`
- Modify: `server/text-to-image/queue.service.ts`
- Modify: `server/text-to-image/queue.service.test.ts`
- Modify: `app/utils/text-to-image-llm.ts`
- Modify: `app/utils/text-to-image-llm.test.ts`
- Modify: `app/pages/index.vue`

**Interfaces:**
- Produces: `TextToImageChapterService.snapshot/insertPrompts/replacePrompt` and stable `TEXT_TO_IMAGE_CHAPTER_CONFLICT`.
- Consumes: resolver, compiler, tracked workspace writes, queue enqueue.

- [ ] **Step 1: Write failing chapter identity and conflict tests**

```typescript
const snapshot = await chapterService.snapshot(projectPath, "manuscript/chapter-1.md");
await writeFile(chapterAbsolutePath, "用户继续编辑后的正文");
await expect(chapterService.insertPrompts({...snapshot, prompts})).rejects.toMatchObject({
    code: "TEXT_TO_IMAGE_CHAPTER_CONFLICT",
});
expect(await readFile(chapterAbsolutePath, "utf8")).toBe("用户继续编辑后的正文");
```

Also prove a delayed completion writes only to the captured `chapterPath`, never the currently selected editor tab.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bunx vitest run server/text-to-image/chapter.service.test.ts server/api/text-to-image/body-prompts.post.test.ts app/utils/text-to-image-llm.test.ts`

Expected: FAIL because the chapter service and body-prompts route do not exist.

- [ ] **Step 3: Implement chapter snapshots and structured placeholders**

```typescript
export type TextToImagePromptPayload = {
    id: string;
    prompt: string;
    negativePrompt: string;
    characterIds: string[];
    sourceChapterHash: string;
};
```

Hash UTF-8 bytes with SHA-256. Insert only resolver outputs with valid anchors and confidence at least `0.65`; never append unresolved prompts to the chapter end. Writes use `writeWorkspaceTextFileTracked` with `knownBefore`.

- [ ] **Step 4: Implement standard Markdown replacement**

```typescript
export function renderTextToImageMarkdown(asset: TextToImageAssetDto): string {
    return `![NovelAI 生成图片](${asset.relativePath} "seed ${asset.seed} | ${asset.width}x${asset.height}")`;
}
```

Within a per-file lock, replace only the exact matching prompt payload. The original chapter hash gates placeholder insertion; completion-time replacement is allowed after unrelated user edits as long as the exact placeholder still exists. If the placeholder is gone or malformed, keep the asset and record `insertedIntoSource: false` without overwriting the file.

- [ ] **Step 5: Implement the server-side body prompt orchestration route**

The route takes `projectPath`, `chapterPath`, `chapterHash`, `llmProviderId`, fixed prompt task/context settings and enabled prompt rules. It performs candidate detection, body LLM call, `<image>` parsing, resolution, compilation, tracked placeholder write, and queue creation; the frontend only supplies the captured chapter identity and non-secret settings.

- [ ] **Step 6: Remove current-tab writes from `app/pages/index.vue`**

Capture `projectPath/chapterPath/hash` immediately after save, submit once, and refresh the same file only if it remains open. API errors use `resolveApiErrorMessage`; HTTP 409 shows a conflict notification and never retries silently.

- [ ] **Step 7: Verify chapter tests GREEN**

Run: `bunx vitest run server/text-to-image/chapter.service.test.ts server/api/text-to-image/body-prompts.post.test.ts server/text-to-image/queue.service.test.ts app/utils/text-to-image-llm.test.ts`

Expected: all focused tests PASS; no generated image is appended to the end solely because placement output is malformed.

### Task 6: Make Character Image-Tag Generation Merge-Safe

**Files:**
- Modify: `app/utils/text-to-image-character-tags.ts`
- Modify: `app/utils/text-to-image-character-tags.test.ts`
- Modify: `server/text-to-image/character-image-tags.ts`
- Modify: `server/text-to-image/character-image-tags.test.ts`
- Modify: `server/api/text-to-image/character-image-tags.post.ts`
- Modify: `app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue`
- Modify: `assets/workspace/.nbook/agent/skills/character-image-tag-generation/SKILL.md`

**Interfaces:**
- Produces: `mergeTextToImageCharacterTags(existing, generated, mode)` where mode is `fill_empty | replace_visual`.
- Preserves: `negativePrompt` and `outfits` in both modes.

- [ ] **Step 1: Write failing schema and merge tests**

```typescript
const merged = mergeTextToImageCharacterTags(existing, generated, "replace_visual");
expect(merged.negativePrompt).toBe(existing.negativePrompt);
expect(merged.outfits).toEqual(existing.outfits);
expect(merged.faceFront).toBe(generated.faceFront);
```

Cover malformed LLM JSON, fill-empty behavior, replacement of visual fields, flat character-file conversion history, and Markdown parse/render round trips.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bunx vitest run app/utils/text-to-image-character-tags.test.ts server/text-to-image/character-image-tags.test.ts`

Expected: FAIL on overwrite behavior and loose response parsing.

- [ ] **Step 3: Introduce an immutable system JSON contract**

The first system message always contains the exact Zod-compatible JSON field contract. The editable task prompt is appended as a separate message and cannot replace the contract. Parse a JSON object, validate it with Zod, and reject prose-only or partial incompatible replies.

- [ ] **Step 4: Implement merge-safe tracked writes**

Default generation uses `fill_empty`. Explicit `replace_visual` replaces only visual fields and still preserves user negative prompts and outfit rows. Use `assertProjectOpenForRoot`, `convertWorkspaceFileToDirectoryTracked` when needed, and `writeWorkspaceTextFileTracked` for `image-tags.md`.

- [ ] **Step 5: Add the explicit UI confirmation**

Keep the primary button as safe fill-empty generation. Add an overflow action “重新生成全部视觉字段”; show a modal confirmation describing that negative prompts and outfits remain untouched.

- [ ] **Step 6: Verify character-tag tests GREEN**

Run: `bunx vitest run app/utils/text-to-image-character-tags.test.ts server/text-to-image/character-image-tags.test.ts server/agent/profiles/character-image-tag-extractor-profile.test.ts`

Expected: all tests PASS and every write is attributed in Workspace History.

### Task 7: Replace Browser Secrets and Queue State in the Frontend

**Files:**
- Modify: `app/stores/text-to-image.ts`
- Modify: `app/stores/text-to-image.test.ts`
- Delete: `app/utils/text-to-image-generation-queue.ts`
- Delete: `app/utils/text-to-image-generation-queue.test.ts`
- Modify: `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`
- Create: `app/components/novel-ide/text-to-image/TextToImageProviderSection.vue`
- Create: `app/components/novel-ide/text-to-image/TextToImageGenerationSection.vue`
- Create: `app/components/novel-ide/text-to-image/TextToImageStyleSection.vue`
- Create: `app/components/novel-ide/text-to-image/TextToImagePromptRulesSection.vue`
- Create: `app/components/novel-ide/text-to-image/TextToImageQueueSummary.vue`

**Interfaces:**
- Store keeps Provider DTOs and selected IDs only; job summaries come from `/api/text-to-image/jobs`.
- Panel emits `open-history` and does not own asset cards.

- [ ] **Step 1: Write failing store serialization and panel contract tests**

```typescript
expect(JSON.stringify(store.$state)).not.toMatch(/apiKey|token|credential|generationResults|characterGroups|outfitGroups/);
expect(wrapper.find("[data-testid='text-to-image-history-button']").exists()).toBe(true);
expect(wrapper.find("[data-testid='text-to-image-result-grid']").exists()).toBe(false);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bunx vitest run app/stores/text-to-image.test.ts app/components/novel-ide/text-to-image`

Expected: FAIL because the store still persists secrets/results/character state and the panel still renders results.

- [ ] **Step 3: Rewrite store persistence**

Persist only non-sensitive editor preferences, selected Provider IDs, style presets, vocabulary sources, prompt context/task bindings and replacement rules. Fetch Provider DTOs and active jobs after Project open; cancellation/retry call server APIs.

- [ ] **Step 4: Split the panel into focused sections**

Use existing theme variables and Lucide icons. The panel title row gains a gallery icon button with tooltip “历史图片”; the body contains configuration sections and a compact queue summary only. Remove the inline generated-image list and all hidden `v-if="false"` character/outfit markup.

- [ ] **Step 5: Verify focused frontend tests GREEN**

Run: `bunx vitest run app/stores/text-to-image.test.ts app/components/novel-ide/text-to-image`

Expected: focused tests PASS; a source search finds no browser queue import and no secret persisted state.

### Task 8: Add the Project History Images Workspace

**Files:**
- Modify: `app/stores/novel-ide.ts`
- Modify: `app/stores/novel-ide.test.ts`
- Modify: `app/pages/index.vue`
- Create: `app/components/novel-ide/text-to-image/TextToImageHistoryWorkspace.vue`
- Create: `app/components/novel-ide/text-to-image/TextToImageAssetDetailDialog.vue`
- Create: `app/components/novel-ide/text-to-image/TextToImageHistoryWorkspace.test.ts`
- Delete: `app/components/novel-ide/text-to-image/TextToImageCharacterWorkspace.vue`

**Interfaces:**
- Produces: Novel IDE tab kind `text-to-image-history` and `openTextToImageHistoryTab()` singleton behavior.
- Consumes: asset/job APIs and existing manual-generation draft store action.

- [ ] **Step 1: Write failing singleton-tab and workspace-state tests**

```typescript
store.openTextToImageHistoryTab();
store.openTextToImageHistoryTab();
expect(store.workspaceTabs.filter((tab) => tab.kind === "text-to-image-history")).toHaveLength(1);
```

Cover loading, empty, API error, queued/running/succeeded filters, source filter, time ordering, delete-refused errors, copy prompt, apply-to-manual, reroll and open source chapter emits.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bunx vitest run app/stores/novel-ide.test.ts app/components/novel-ide/text-to-image/TextToImageHistoryWorkspace.test.ts`

Expected: FAIL because the tab kind and component do not exist.

- [ ] **Step 3: Implement the singleton workspace tab**

Add `text-to-image-history` to the explicit union and tab renderer. The panel's `open-history` event selects an existing current-Project history tab or creates one; close behavior follows other middle-workspace tabs.

- [ ] **Step 4: Implement the work-focused gallery**

Use an unframed toolbar for source/status filters, sort and refresh; a responsive asset-card grid; and one detail dialog. Each image URL is `/api/text-to-image/assets/<id>/content?projectPath=...`. Use `resolveApiErrorMessage` and global notifications for copy/reroll/delete outcomes.

- [ ] **Step 5: Implement protected deletion and source actions**

Require a confirmation dialog before deletion. A referenced-asset response keeps the card and tells the user to remove the Markdown reference first. “打开来源章节” selects the exact `sourcePath`; “套用到手动生成” copies prompt/settings without secrets; reroll creates a new job and leaves the old asset unchanged.

- [ ] **Step 6: Verify history workspace tests GREEN**

Run: `bunx vitest run app/stores/novel-ide.test.ts app/components/novel-ide/text-to-image/TextToImageHistoryWorkspace.test.ts`

Expected: all focused tests PASS; the configuration panel contains no image history grid.

### Task 9: Hard-Cut the Custom Result Node and Render Controlled Project Images

**Files:**
- Modify: `app/components/markdown-studio/tiptap/TextToImagePrompt.ts`
- Delete: `app/components/markdown-studio/tiptap/TextToImageResult.ts`
- Modify: Markdown Studio extension registration file found by `rg -n "TextToImageResult|TextToImagePrompt" app/components/markdown-studio`
- Create: `app/utils/text-to-image-asset-url.ts`
- Create: `app/utils/text-to-image-asset-url.test.ts`
- Modify: `app/utils/text-to-image-llm.ts`
- Modify: `app/utils/text-to-image-llm.test.ts`

**Interfaces:**
- Produces: `resolveTextToImageAssetUrl(projectPath, markdownSrc)` for render-only mapping.
- Serialization invariant: the Markdown document keeps `assets/text-to-image/...`; only the rendered `src` uses the controlled API.

- [ ] **Step 1: Write failing serialization tests**

```typescript
expect(resolveTextToImageAssetUrl("workspace/book", "assets/text-to-image/2026/07/asset-a.png"))
    .toContain("/api/text-to-image/assets/asset-a/content");
expect(serializeEditorImage(editorImage)).toContain("![](assets/text-to-image/2026/07/a.png");
expect(serializedMarkdown).not.toContain("text-to-image-result");
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bunx vitest run app/utils/text-to-image-asset-url.test.ts app/utils/text-to-image-llm.test.ts`

Expected: FAIL because current result nodes carry JSON and absolute image paths.

- [ ] **Step 3: Implement render-only URL mapping**

Accept only normalized `assets/text-to-image/YYYY/MM/<asset-id>.<ext>` Markdown sources. Parse the asset ID from the filename and render through the guarded `/api/text-to-image/assets/<asset-id>/content` endpoint; the endpoint still verifies that the DB record's `relativePath` matches its contained Project path. Reject traversal and external URLs from this special mapper while leaving ordinary Markdown image handling unchanged.

- [ ] **Step 4: Remove the custom result extension**

Keep `TextToImagePrompt` only for pending placeholders. Remove result extension registration, parser, commands and reroll-history attrs. Existing old result tags remain raw Markdown text by design; no migration or fallback absolute-path reader is introduced.

- [ ] **Step 5: Verify standard Markdown behavior GREEN**

Run: `bunx vitest run app/utils/text-to-image-asset-url.test.ts app/utils/text-to-image-llm.test.ts app/components/markdown-studio`

Expected: focused tests PASS and source search finds no runtime `text-to-image-result` implementation.

### Task 10: Remove Dead State, Run the Completion Audit, and Sync Documentation

**Files:**
- Modify: `app/stores/text-to-image.ts`
- Modify/Delete: consumers reported by the dead-code searches below
- Modify: `docs/tasks/text-to-image-panel/README.md`
- Modify: `PROJECT-STATUS.md`
- Modify: `task_plan.md`
- Modify: `findings.md`
- Modify: `progress.md`

**Interfaces:**
- Produces: clean repository contracts and recorded verification evidence.
- Acceptance source: `docs/superpowers/specs/2026-07-10-text-to-image-overhaul-design.md` section 17.

- [ ] **Step 1: Run the hard-cut source audit**

Run:

```powershell
rg -n "characterGroups|outfitGroups|generationResults|TextToImageCharacterWorkspace|text-to-image-character|TextToImageResult|text-to-image-result|text-to-image-generation-queue|select-output-directory|imageBaseUrl|outputDirectory" app server shared
```

Expected: zero live-code matches; allowed matches are limited to historical documentation or explicit negative assertions in tests.

- [ ] **Step 2: Delete or update every remaining live consumer**

Remove unreachable helpers and obsolete tests. Do not retain empty compatibility functions. Keep style presets, tag vocabulary, prompt replacement rules, LLM settings workspace and manual generation.

- [ ] **Step 3: Run the complete text-to-image test set**

Run:

```powershell
$tests = rg --files app server shared | rg "text-to-image.*\.test\.(ts|tsx)$|body-image.*\.test\.(ts|tsx)$|character-image-tag.*\.test\.(ts|tsx)$"
bunx vitest run $tests
```

Expected: all discovered focused tests PASS with no unhandled rejection or open handle.

- [ ] **Step 4: Run generated-artifact and type gates**

Run: `bun run generate`

Run: `bun run typecheck`

Expected: generated Prisma/profile contracts are current. If typecheck fails outside the touched text-to-image surface, record the exact pre-existing file/error separately; all text-to-image type errors must be zero.

- [ ] **Step 5: Review the implementation against all ten acceptance rows**

For each issue 1-9 and the history-page requirement, record the exact test/file evidence in `docs/tasks/text-to-image-panel/README.md`. Explicitly compare actual implementation with this plan and describe every deviation and its reason.

- [ ] **Step 6: Sync repository status documents**

Update `PROJECT-STATUS.md` to remove obsolete text-to-image follow-ups, update the existing task walkthrough rather than creating a new fragmented task, mark completed phases in `task_plan.md`, and append final commands/results to `progress.md`. Record that browser verification was not run under the repository rule and offer it as a separate user-authorized step.

---

## Execution Order and Review Gates

1. Tasks 1-3 establish security and persistence before any frontend consumes the new API.
2. Task 4 establishes deterministic prompt behavior, then Task 7 hard-cuts the frontend to Provider IDs so Tasks 5-6 can consume the final store contract.
3. Tasks 5-6 establish conflict-safe正文/角色 authored-file writes; Tasks 8-9 add history and remove the old editor result surface.
4. Task 10 is the mandatory completion audit; no task is considered complete solely because its implementation compiles.

After each task, run only that task's focused tests and review its diff before starting the next task. Run full typecheck and the aggregate text-to-image suite only in Task 10, matching the repository's risk-scaled test policy.
