# Route B NovelAI Provider Reconciliation Implementation Plan

> **For Codex:** Follow test-driven-development and verification-before-completion. The frozen design is the authority; do not re-open TTP (text-to-picture) tagData or browser persistence directions.

**Goal:** Explicitly reconcile duplicate per-user NovelAI Providers, safely terminate unfinished Jobs bound to discarded Providers, and converge the App SQLite database to the exact partial unique singleton constraint.

**Architecture:** A strict selection token binds the exact owner-scoped candidate set. The Provider service serializes the entire one-time reconciliation under an App SQLite owner write lock. It first applies idempotent status transitions in every discoverable Project SQLite, then deletes discarded Provider rows in the same App transaction, and finally installs the target partial unique index when no owner remains duplicated. A migration-safe pair of SQLite triggers blocks new duplicates before the final index can be installed.

**Tech Stack:** TypeScript, Nitro/H3, Zod, Prisma 7 with libSQL SQLite adapter, Vue 3/Pinia, Vitest.

---

## Task 1: Contract tests and strict types

**Files:**
- Modify: `shared/dto/text-to-image.dto.ts`
- Modify: `server/text-to-image/schemas.ts`
- Modify: `server/text-to-image/provider.service.test.ts`
- Create: `server/text-to-image/provider-reconciliation.service.test.ts`

1. Add failing tests for a deterministic candidate-set `selectionToken`, explicit keep selection, stale token rejection, no deletion when Project migration fails, and result impact counts.
2. Add `configuration_stale` and `outcome_unknown` Job status contracts.
3. Add a strict reconciliation request schema containing only `keepProviderId` and `selectionToken`.
4. Run the focused tests and confirm RED for missing behavior, not fixture errors.

## Task 2: Database-safe reconciliation core

**Files:**
- Modify: `server/text-to-image/provider.service.ts`
- Create: `server/text-to-image/provider-reconciliation.service.ts`
- Modify: `server/text-to-image/queue.service.ts`
- Modify: `prisma/project.schema.prisma`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/schema.sqlite.prisma`
- Create: `prisma/migrations/sqlite/20260719140000_novelai_provider_singleton_transition/migration.sql`
- Modify: `scripts/db/sqlite-migrate.mjs`

1. Replace the process-only mutation lock with a store-scoped App SQLite write transaction using a negative owner lock key.
2. Implement exact selection token calculation and transactional revalidation.
3. Enumerate Project Workspaces, update discarded-provider queued/running Jobs in per-Project transactions, preserve completed Jobs/Assets, and return typed impact counts.
4. Abort in-memory discarded-provider attempts after durable status transition; Queue must not overwrite a migration terminal status.
5. Add transition triggers and a finalizer for the exact `one_novelai_provider_per_owner` partial unique index. Map trigger/index conflicts to a stable service error.
6. Make the new tests GREEN.

## Task 3: API and one-time UI

**Files:**
- Create: `server/api/text-to-image/providers/novelai/reconcile.post.ts`
- Modify: `app/components/novel-ide/text-to-image/NovelTextToImagePanel.vue`
- Modify: `app/stores/text-to-image.ts`

1. Add an owner-scoped POST route with strict body parsing and stable 409 error payloads for selection-required/stale/conflict exits.
2. Replace the placeholder warning with candidate cards, one explicit radio selection, a separate confirmation checkbox, and a disabled-until-confirmed reconciliation action.
3. Show the selected Provider's migration model evidence without exposing credential material; refresh Provider/Recipe state after success.
4. Keep all normal Provider save/test and worker entry points disabled while selection is unresolved.

## Task 4: Verification and documentation

**Files:**
- Modify: `docs/tasks/text-to-image-panel/README.md`
- Modify: `PROJECT-STATUS.md`
- Modify: `.planning/2026-07-19-route-b-provider-reconciliation/*`

1. Run Prisma generation, focused Provider/reconciliation/Queue tests, and full typecheck.
2. Request an independent spec/code review and resolve every P1/P2 finding.
3. Record actual verification output, changed architecture, remaining credentialRevision/persistent lane work, and any deviations from this plan.
4. Do not run browser validation, git staging, commit, push, or release.
