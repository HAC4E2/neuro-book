# Route B P0 Contract Foundation Implementation Plan

> **执行约束：** 按 `test-driven-development` 与 `executing-plans` 逐任务实施；每项先得到可解释的 RED，再写最小系统实现。用户明确禁止提交，因此跳过计划模板中的 commit 步骤。

**Goal:** 建立 Route B 后续 P2–P4 共用的 Storyboard/Pattern/overlay 严格合同、规范哈希和 fail-closed resolver，并系统性修复 Agent 顶层 session 并发分配竞态。

**Architecture:** Shared 层只保存版本化 Zod 合同与纯 canonical/hash 逻辑；Markdown codec 在 server 层负责严格 YAML 边界；领域 resolver 在 server 层执行整份 overlay 的确定性合并。Session 创建使用 repository 级 creation tail 串行化“分配 ID + 初始化 JSONL”的完整临界区，避免仅锁计数器后仍覆盖同一文件。

**Tech Stack:** TypeScript、Zod 4、yaml 2、Node crypto、Vitest、现有 JSONL session repository。

---

## Contract decisions frozen for this slice

- ID 使用有界 ASCII schema；所有对象 strict，未知字段拒绝。
- Hash 统一为 `sha256:<64 lowercase hex>`；对象 key 递归排序，数组保持业务顺序。
- Storyboard `semanticHash` 排除 source/review/provenance/risks/正文与 package identity；`diagnosticHash` 只覆盖规范 diagnostics、未解析宏和转换风险。
- Pattern planning/render hash 严格分域；身份、启用、retrieval/applicability/intent 影响 planning，positive/negative resolutions 与 provider syntax refs 影响 render。
- Overlay stale 或任一冲突时整份不应用并返回 typed diagnostics；base 仍可运行。
- Companion pair 的 presetId/patternSetId/packageId/resourceKey 必须一致；缺失或不一致 fail-closed。
- 本批不实现 import API/UI、global publish journal、Danbooru 下载、Director planning、V2 placeholder 或图片执行。

### Task 1: Shared canonical/hash primitives and SemanticTagResolution

**Files:**

- Create: `shared/text-to-image-contract-hash.ts`
- Create: `shared/text-to-image-tag-resolution.ts`
- Create: `shared/text-to-image-tag-resolution.test.ts`

**RED tests:**

1. canonical object key order does not change hash; array order does.
2. canonical/replacement/provider_passthrough snapshots strict round-trip.
3. unknown keys, invalid selectedBy/kind combinations, malformed hashes and unsafe passthrough text fail.
4. `resolvedAt` changes do not change semantic resolution hash; evidence changes do.

**Implementation:**

- Implement a typed contract hash helper accepting JSON-compatible contract values, without a generic unknown-valued persistence abstraction.
- Define versioned common envelope and three discriminated terminal snapshots.
- Validate provider/model scope, decision provenance and passthrough sanitizer invariants.

**Verify:**

`bunx vitest run shared/text-to-image-tag-resolution.test.ts`

### Task 2: Storyboard Preset and Overlay strict contracts

**Files:**

- Create: `shared/text-to-image-storyboard-preset.ts`
- Create: `shared/text-to-image-storyboard-preset.test.ts`

**RED tests:**

1. all seven registered rule kinds parse and unknown kind/effect/NovelAI scalar keys fail.
2. semantic hash ignores title/source/review/provenance/risk ordering but changes for executable fields and rule array order.
3. diagnostic hash changes for blocking issues, unresolved macros and conversion diagnostics.
4. review status resolves to pending/approved/stale/rejected from current hashes.
5. overlay replace/disable/append schemas reject mismatched embedded IDs and duplicate operations.

**Implementation:**

- Define strict source/review/matching/default/macro/rule discriminated unions.
- Define strict overlay operation union and activation/hash helpers.
- Keep model/sampler/steps/seed/dimensions/style/provider credentials outside every schema.

**Verify:**

`bunx vitest run shared/text-to-image-storyboard-preset.test.ts`

### Task 3: Tag Pattern Set and Overlay strict contracts

**Files:**

- Create: `shared/text-to-image-tag-pattern.ts`
- Create: `shared/text-to-image-tag-pattern.test.ts`

**RED tests:**

1. Pattern set strict round-trip with canonical/replacement/passthrough refs.
2. unknown/unused/duplicate/cross-pattern resolution refs fail.
3. title/confidence/provenance changes do not change planning/render hash.
4. trigger/applicability/intent/enabled changes only planning hash; executable Tag groups/syntax refs only render hash; identity changes planning.
5. disabled patterns remain representable but never appear in effective candidate output.
6. style/quality/model/sampler/steps/seed/secret/finalPrompt/instruction/tool keys fail.

**Implementation:**

- Define strict retrieval/applicability/intent/groups/snapshot maps/provider syntax node contracts.
- Validate per-pattern reference ownership and executable-key exact use.
- Implement planning/render hash builders and review state resolution.

**Verify:**

`bunx vitest run shared/text-to-image-tag-pattern.test.ts`

### Task 4: Strict Markdown codecs

**Files:**

- Create: `server/text-to-image/storyboard-preset.codec.ts`
- Create: `server/text-to-image/storyboard-preset.codec.test.ts`
- Create: `server/text-to-image/tag-pattern.codec.ts`
- Create: `server/text-to-image/tag-pattern.codec.test.ts`

**RED tests:**

1. canonical render/parse round-trip is stable.
2. duplicate YAML keys, anchors, aliases, merge keys, custom tags and non-object frontmatter fail.
3. Markdown body changes file hash only; semantic/planning/render hashes stay stable.
4. V1 schema mismatch and unknown frontmatter keys fail.

**Implementation:**

- Parse with strict/unique-key YAML plus explicit AST rejection for anchors/aliases/merge/custom tags.
- Render fixed frontmatter ordering and human-only body.
- Return fileHash separately from semantic hashes.

**Verify:**

`bunx vitest run server/text-to-image/storyboard-preset.codec.test.ts server/text-to-image/tag-pattern.codec.test.ts`

### Task 5: Fail-closed overlay and companion resolvers

**Files:**

- Create: `server/text-to-image/storyboard-rule-resolver.ts`
- Create: `server/text-to-image/storyboard-rule-resolver.test.ts`
- Create: `server/text-to-image/tag-pattern-resolver.ts`
- Create: `server/text-to-image/tag-pattern-resolver.test.ts`

**RED tests:**

1. replace/disable/append produce stable `order ASC, id ASC` output and provenance.
2. unknown target, append collision, duplicate ID/operation, embedded ID mismatch and stale base hash reject the whole overlay.
3. stale/conflicting overlay leaves approved global base runnable with typed warning; strict caller can block.
4. pair ID/package/resource mismatch or missing companion fails closed.
5. effective hashes change only in their specified planning/render domains.

**Implementation:**

- Keep merge logic domain-specific; do not call generic Config merge.
- Return discriminated `applied | skipped_stale | rejected_conflict` outcomes and effective hashes.

**Verify:**

`bunx vitest run server/text-to-image/storyboard-rule-resolver.test.ts server/text-to-image/tag-pattern-resolver.test.ts`

### Task 6: Agent session creation concurrency

**Files:**

- Modify: `server/agent/session/session-repo.ts`
- Modify: `server/agent/session/session-repo.test.ts`

**RED tests:**

1. many concurrent `createSession()` calls on one repository instance return unique monotonic IDs and intact independent JSONL files.
2. a failed creation does not permanently poison the creation tail; the next create can proceed.
3. sequence value advances beyond every successfully initialized session.

**Implementation:**

- Add a repository-owned `creationTail: Promise<void>` and a documented `withCreationLock()` helper.
- Serialize the complete `nextSessionId + header + initial leaf` critical section.
- Always release the tail in `finally`; do not add sleeps or rely on scheduler ordering.

**Verify:**

`bunx vitest run server/agent/session/session-repo.test.ts`

### Task 7: Integrated verification and documentation

**Files:**

- Modify: `docs/tasks/text-to-image-panel/README.md`
- Modify: `PROJECT-STATUS.md` only after verified architectural state changes
- Modify: `.planning/2026-07-19-route-b-completion/{task_plan,findings,progress}.md`

**Checks:**

1. Run all new focused contract/resolver/session tests.
2. Run nearby Recipe/Queue/Director binding regression tests if shared types affect them.
3. Run `bun run typecheck`.
4. Search negative boundaries for NovelAI scalar keys in Director/Storyboard schemas and for any new TTP（text-to-picture）`tagData` reference.
5. Record actual deviations and remaining P2–P6 gaps; do not claim Route B completion.

**No browser step:** browser verification remains excluded until the user explicitly authorizes it.
