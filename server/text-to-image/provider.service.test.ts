import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    TextToImageProviderNotConfiguredError,
    TextToImageProviderReconciliationInProgressError,
    TextToImageProviderSelectionStaleError,
    TextToImageProviderService,
    type TextToImageProviderJobReconciler,
    type TextToImageProviderRecord,
    type TextToImageProviderReconciliationRecord,
    type TextToImageProviderRevisionInvalidationRecord,
    type TextToImageProviderStore,
} from "nbook/server/text-to-image/provider.service";
import {resolveTextToImageProviderHttpError} from "nbook/server/text-to-image/provider-http-error";

const temporaryDirectories: string[] = [];

describe("TextToImageProviderService", () => {
    afterEach(async () => {
        await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
            await rm(directory, {recursive: true, force: true});
        }));
    });

    it("forces the singleton NovelAI provider to the official image endpoint and 15s minimum", async () => {
        const service = new TextToImageProviderService(new InMemoryProviderStore(), await createKeyPath());

        const provider = await service.saveNovelAi(7, {
            name: "NovelAI",
            credential: "server-only-token",
            requestIntervalMs: 0,
        });

        expect(provider.baseUrl).toBe("https://image.novelai.net");
        expect(provider.settings.requestIntervalMs).toBe(15_000);
        await expect(service.assertNovelAiReady(7, provider.id)).resolves.toMatchObject({ownerUserId: 7, providerId: provider.id});
        await expect(service.resolveNovelAiSnapshot(7)).resolves.toMatchObject({ownerUserId: 7, providerId: provider.id});
    });

    it("只在明文 token 变化时递增 revision，并为旧 revision 建立一次失效 saga", async () => {
        const store = new InMemoryProviderStore();
        const jobs = new InMemoryJobReconciler();
        const service = new TextToImageProviderService(store, await createKeyPath(), jobs);
        const provider = await service.saveNovelAi(7, {
            name: "NovelAI",
            credential: "token-one",
            requestIntervalMs: 15_000,
        });

        await expect(service.assertNovelAiReady(7, provider.id)).resolves.toMatchObject({credentialRevision: 1});
        await service.saveNovelAi(7, {name: "NovelAI renamed", requestIntervalMs: 20_000});
        await expect(service.assertNovelAiReady(7, provider.id)).resolves.toMatchObject({credentialRevision: 1});
        await service.saveNovelAi(7, {name: "NovelAI renamed", credential: "token-one", requestIntervalMs: 20_000});
        await expect(service.assertNovelAiReady(7, provider.id)).resolves.toMatchObject({credentialRevision: 1});
        expect(jobs.revisionCalls).toEqual([]);
        await service.saveNovelAi(7, {name: "NovelAI renamed", credential: "token-two", requestIntervalMs: 20_000});
        await expect(service.assertNovelAiReady(7, provider.id)).resolves.toMatchObject({credentialRevision: 2});
        expect(jobs.revisionCalls).toEqual([{ownerUserId: 7, providerId: provider.id, oldRevision: 1}]);
        expect(store.revisionInvalidations).toMatchObject([{oldRevision: 1, newRevision: 2, state: "completed"}]);
    });

    it("拒绝让缺少完整 sealed credential 的唯一 NovelAI Provider 创建 Job", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        const provider = await service.saveNovelAi(7, {name: "NovelAI", credential: "server-only-token", requestIntervalMs: 15_000});
        Object.assign(store.records[0]!, {credentialCiphertext: "", credentialIv: "", credentialTag: ""});

        await expect(service.assertNovelAiReady(7, provider.id)).rejects.toBeInstanceOf(TextToImageProviderNotConfiguredError);
        await expect(service.resolveNovelAiCredential(7, provider.id)).rejects.toMatchObject({
            code: "TEXT_TO_IMAGE_PROVIDER_NOT_CONFIGURED",
        });
        await expect(service.saveNovelAi(7, {name: "Renamed", requestIntervalMs: 15_000})).rejects.toBeInstanceOf(TextToImageProviderNotConfiguredError);

        await service.saveNovelAi(7, {name: "Renamed", credential: "renewed-token", requestIntervalMs: 15_000});
        await expect(service.assertNovelAiReady(7, provider.id)).resolves.toMatchObject({ownerUserId: 7, providerId: provider.id});
    });

    it("没有 NovelAI Provider 时 worker 出口返回稳定未配置错误", async () => {
        const service = new TextToImageProviderService(new InMemoryProviderStore(), await createKeyPath());

        await expect(service.assertNovelAiReady(7, 999)).rejects.toMatchObject({code: "TEXT_TO_IMAGE_PROVIDER_NOT_CONFIGURED"});
        await expect(service.resolveNovelAiCredential(7, 999)).rejects.toBeInstanceOf(TextToImageProviderNotConfiguredError);

        const mapped = resolveTextToImageProviderHttpError(new TextToImageProviderNotConfiguredError());
        expect(mapped).toMatchObject({
            statusCode: 409,
            data: {code: "TEXT_TO_IMAGE_PROVIDER_NOT_CONFIGURED"},
        });
    });

    it("inspects 0/1/many NovelAI records without exposing credentials", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());

        await expect(service.inspectNovelAi(7)).resolves.toEqual({state: "unconfigured", provider: null, candidates: [], recipeMigrationModels: [], selectionToken: null, reconciliationKeepProviderId: null});
        const provider = await service.saveNovelAi(7, {name: "NovelAI", credential: "first", requestIntervalMs: 15_000});
        await expect(service.inspectNovelAi(7)).resolves.toMatchObject({
            state: "configured",
            provider: {id: provider.id, hasCredential: true},
            candidates: [{id: provider.id}],
        });
        store.records.push({...store.records[0]!, id: 2, name: "NovelAI duplicate"});
        const inspection = await service.inspectNovelAi(7);
        expect(inspection).toMatchObject({state: "selection_required", provider: null});
        expect(inspection.candidates.map((candidate) => candidate.id)).toEqual([1, 2]);
        expect(inspection.selectionToken).toMatch(/^[a-f0-9]{64}$/u);
        expect(JSON.stringify(inspection)).not.toContain("credentialCiphertext");
    });

    it("候选配置发生变化后产生新的 selection token", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        await service.saveNovelAi(7, {name: "NovelAI A", credential: "first", requestIntervalMs: 15_000});
        store.records.push({...store.records[0]!, id: 2, name: "NovelAI B"});
        const first = await service.inspectNovelAi(7);

        store.records[1]!.name = "NovelAI B changed";
        store.records[1]!.updatedAt = new Date("2026-07-10T00:00:01.000Z");
        const second = await service.inspectNovelAi(7);

        expect(first.selectionToken).not.toBe(second.selectionToken);
    });

    it("显式保留一条 Provider，并在删除前失效其余 Provider 的旧 Job", async () => {
        const store = new InMemoryProviderStore();
        const jobs = new InMemoryJobReconciler();
        const service = new TextToImageProviderService(store, await createKeyPath(), jobs);
        await service.saveNovelAi(7, {name: "NovelAI A", credential: "first", requestIntervalMs: 15_000});
        store.records.push({...store.records[0]!, id: 2, name: "NovelAI B"});
        store.records[1]!.settings = {allowPrivateNetwork: false, requestIntervalMs: 0};
        const inspection = await service.inspectNovelAi(7);

        const result = await service.reconcileNovelAi(7, {
            keepProviderId: 2,
            selectionToken: inspection.selectionToken!,
        });

        expect(jobs.calls).toEqual([[1]]);
        expect(store.records.map((record) => record.id)).toEqual([2]);
        expect(result).toMatchObject({
            inspection: {state: "configured", provider: {id: 2, settings: {requestIntervalMs: 15_000}}, selectionToken: null},
            impacts: [{projectPath: "workspace/book", configurationStale: 2, outcomeUnknown: 1}],
            constraintState: "enforced",
        });
    });

    it("拒绝陈旧 token，且不处理 Job、不删除 Provider", async () => {
        const store = new InMemoryProviderStore();
        const jobs = new InMemoryJobReconciler();
        const service = new TextToImageProviderService(store, await createKeyPath(), jobs);
        await service.saveNovelAi(7, {name: "NovelAI A", credential: "first", requestIntervalMs: 15_000});
        store.records.push({...store.records[0]!, id: 2, name: "NovelAI B"});

        await expect(service.reconcileNovelAi(7, {
            keepProviderId: 2,
            selectionToken: "0".repeat(64),
        })).rejects.toBeInstanceOf(TextToImageProviderSelectionStaleError);
        expect(jobs.calls).toEqual([]);
        expect(store.records).toHaveLength(2);
    });

    it("Project 部分提交失败后持久化原选择，并拒绝改选另一条 Provider", async () => {
        const store = new InMemoryProviderStore();
        let reconciliationCalls = 0;
        const jobs: TextToImageProviderJobReconciler = {
            async invalidate(providerSnapshots) {
                reconciliationCalls += 1;
                if (reconciliationCalls === 1) {
                    expect(providerSnapshots.map((provider) => provider.providerId)).toEqual([2, 3]);
                    throw new Error("second project database busy");
                }
                return [{projectPath: "workspace/second", configurationStale: 1, outcomeUnknown: 0}];
            },
            async invalidateRevision() {
                return [];
            },
        };
        const service = new TextToImageProviderService(store, await createKeyPath(), jobs);
        await service.saveNovelAi(7, {name: "NovelAI A", credential: "first", requestIntervalMs: 15_000});
        store.records.push({...store.records[0]!, id: 2, name: "NovelAI B"});
        store.records.push({...store.records[0]!, id: 3, name: "NovelAI C"});
        const inspection = await service.inspectNovelAi(7);

        await expect(service.reconcileNovelAi(7, {
            keepProviderId: 1,
            selectionToken: inspection.selectionToken!,
        })).rejects.toThrow("second project database busy");
        expect(store.records).toHaveLength(3);
        await expect(service.inspectNovelAi(7)).resolves.toMatchObject({
            state: "selection_required",
            reconciliationKeepProviderId: 1,
            selectionToken: inspection.selectionToken,
        });

        await expect(service.reconcileNovelAi(7, {
            keepProviderId: 2,
            selectionToken: inspection.selectionToken!,
        })).rejects.toBeInstanceOf(TextToImageProviderReconciliationInProgressError);
        expect(reconciliationCalls).toBe(1);

        await expect(service.reconcileNovelAi(7, {
            keepProviderId: 1,
            selectionToken: inspection.selectionToken!,
        })).resolves.toMatchObject({inspection: {state: "configured", provider: {id: 1}}});
        expect(store.records.map((provider) => provider.id)).toEqual([1]);
        expect(store.reconciliations).toHaveLength(0);
        expect(reconciliationCalls).toBe(2);
    });

    it("保留旧 Provider 实际模型作为一次性 Recipe migration evidence", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        await service.saveNovelAi(7, {name: "NovelAI", credential: "first", requestIntervalMs: 15_000});
        store.records[0]!.recipeMigrationModel = "nai-diffusion-3";

        await expect(service.inspectNovelAi(7)).resolves.toMatchObject({
            recipeMigrationModels: [{providerId: 1, model: "nai-diffusion-3"}],
        });
    });

    it("creates once and updates the same singleton id", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        const created = await service.saveNovelAi(7, {name: "NovelAI", credential: "first", requestIntervalMs: 15_000});

        const updated = await service.saveNovelAi(7, {name: "NovelAI renamed", requestIntervalMs: 30_000});

        expect(updated.id).toBe(created.id);
        expect(updated).toMatchObject({name: "NovelAI renamed", settings: {requestIntervalMs: 30_000}});
        expect(store.records).toHaveLength(1);
        await expect(service.resolveNovelAiCredential(7, created.id)).resolves.toMatchObject({credential: "first"});
    });

    it("两个并发首次 PUT 只能创建一条 NovelAI singleton", async () => {
        const store = new InMemoryProviderStore();
        const keyPath = await createKeyPath();
        const firstService = new TextToImageProviderService(store, keyPath);
        const secondService = new TextToImageProviderService(store, keyPath);

        const [first, second] = await Promise.all([
            firstService.saveNovelAi(7, {name: "NovelAI A", credential: "first", requestIntervalMs: 15_000}),
            secondService.saveNovelAi(7, {name: "NovelAI B", credential: "second", requestIntervalMs: 15_000}),
        ]);

        expect(first.id).toBe(second.id);
        expect(store.records.filter((record) => record.kind === "novelai")).toHaveLength(1);
    });

    it("fails closed when duplicate NovelAI records need explicit selection", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        const created = await service.saveNovelAi(7, {name: "NovelAI", credential: "first", requestIntervalMs: 15_000});
        store.records.push({...store.records[0]!, id: 2, name: "NovelAI duplicate"});

        await expect(service.saveNovelAi(7, {name: "No guessing", requestIntervalMs: 15_000})).rejects.toMatchObject({
            code: "TEXT_TO_IMAGE_PROVIDER_SELECTION_REQUIRED",
        });
        await expect(service.resolveNovelAiCredential(7, created.id)).rejects.toMatchObject({
            code: "TEXT_TO_IMAGE_PROVIDER_SELECTION_REQUIRED",
        });
    });

});

async function createKeyPath(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "nbook-text-to-image-provider-"));
    temporaryDirectories.push(directory);
    return path.join(directory, "workspace", ".nbook", "secrets", "text-to-image.key");
}

class InMemoryProviderStore implements TextToImageProviderStore {
    records: TextToImageProviderRecord[] = [];
    reconciliations: TextToImageProviderReconciliationRecord[] = [];
    revisionInvalidations: TextToImageProviderRevisionInvalidationRecord[] = [];

    async create(record: Omit<TextToImageProviderRecord, "id" | "createdAt" | "updatedAt">): Promise<TextToImageProviderRecord> {
        const now = new Date("2026-07-10T00:00:00.000Z");
        const created = {id: this.records.length + 1, ...record, createdAt: now, updatedAt: now};
        this.records.push(created);
        return created;
    }

    async findMany(ownerUserId: number): Promise<TextToImageProviderRecord[]> {
        return this.records.filter((record) => record.ownerUserId === ownerUserId);
    }

    async find(ownerUserId: number, id: number): Promise<TextToImageProviderRecord | null> {
        return this.records.find((record) => record.ownerUserId === ownerUserId && record.id === id) ?? null;
    }

    async update(ownerUserId: number, id: number, update: Partial<Omit<TextToImageProviderRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">>): Promise<TextToImageProviderRecord | null> {
        const record = await this.find(ownerUserId, id);
        if (!record) {
            return null;
        }
        Object.assign(record, update, {updatedAt: new Date("2026-07-10T00:00:00.000Z")});
        return record;
    }

    async delete(ownerUserId: number, id: number): Promise<boolean> {
        const index = this.records.findIndex((record) => record.ownerUserId === ownerUserId && record.id === id);
        if (index < 0) {
            return false;
        }
        this.records.splice(index, 1);
        return true;
    }

    async findReconciliation(ownerUserId: number): Promise<TextToImageProviderReconciliationRecord | null> {
        return this.reconciliations.find((record) => record.ownerUserId === ownerUserId) ?? null;
    }

    async createReconciliation(record: Omit<TextToImageProviderReconciliationRecord, "createdAt" | "updatedAt">): Promise<TextToImageProviderReconciliationRecord> {
        const now = new Date("2026-07-10T00:00:00.000Z");
        const created = {...record, createdAt: now, updatedAt: now};
        this.reconciliations.push(created);
        return created;
    }

    async deleteReconciliation(ownerUserId: number, selectionToken: string): Promise<boolean> {
        const index = this.reconciliations.findIndex((record) => record.ownerUserId === ownerUserId && record.selectionToken === selectionToken);
        if (index < 0) {
            return false;
        }
        this.reconciliations.splice(index, 1);
        return true;
    }

    async invalidateCredentialRevision(ownerUserId: number, providerId: number, oldRevision: number, newRevision: number): Promise<TextToImageProviderRevisionInvalidationRecord[]> {
        const existing = this.revisionInvalidations.find((record) => record.ownerUserId === ownerUserId
            && record.providerId === providerId
            && record.oldRevision === oldRevision
            && record.newRevision === newRevision);
        if (existing) return [existing];
        const now = new Date("2026-07-10T00:00:00.000Z");
        const created: TextToImageProviderRevisionInvalidationRecord = {
            id: `provider-revision:${ownerUserId}:${providerId}:${oldRevision}:${newRevision}`,
            ownerUserId,
            providerId,
            oldRevision,
            newRevision,
            projectId: "project-1",
            projectPath: "workspace/book",
            state: "pending",
            attemptCount: 0,
            lastError: null,
            createdAt: now,
            updatedAt: now,
        };
        this.revisionInvalidations.push(created);
        return [created];
    }

    async findPendingRevisionInvalidations(limit: number): Promise<TextToImageProviderRevisionInvalidationRecord[]> {
        return this.revisionInvalidations.filter((record) => record.state === "pending").slice(0, limit);
    }

    async completeRevisionInvalidation(id: string): Promise<boolean> {
        const record = this.revisionInvalidations.find((candidate) => candidate.id === id && candidate.state === "pending");
        if (!record) return false;
        record.state = "completed";
        record.lastError = null;
        return true;
    }

    async failRevisionInvalidation(id: string, message: string): Promise<boolean> {
        const record = this.revisionInvalidations.find((candidate) => candidate.id === id && candidate.state === "pending");
        if (!record) return false;
        record.attemptCount += 1;
        record.lastError = message;
        return true;
    }

    async withOwnerMutation<T>(_ownerUserId: number, operation: (store: TextToImageProviderStore) => Promise<T>): Promise<T> {
        const snapshot = this.records.map((record) => ({...record, settings: {...record.settings}}));
        const reconciliationSnapshot = this.reconciliations.map((record) => ({
            ...record,
            discardedProviders: record.discardedProviders.map((provider) => ({...provider, settings: {...provider.settings}})),
        }));
        const revisionSnapshot = this.revisionInvalidations.map((record) => ({...record}));
        try {
            return await operation(this);
        } catch (error) {
            this.records = snapshot;
            this.reconciliations = reconciliationSnapshot;
            this.revisionInvalidations = revisionSnapshot;
            throw error;
        }
    }

    async finalizeNovelAiConstraint(): Promise<"enforced" | "pending_other_owners"> {
        const counts = new Map<number, number>();
        for (const record of this.records.filter((candidate) => candidate.kind === "novelai")) {
            counts.set(record.ownerUserId, (counts.get(record.ownerUserId) ?? 0) + 1);
        }
        return [...counts.values()].some((count) => count > 1) ? "pending_other_owners" : "enforced";
    }
}

class InMemoryJobReconciler implements TextToImageProviderJobReconciler {
    calls: number[][] = [];
    revisionCalls: Array<{ownerUserId: number; providerId: number; oldRevision: number}> = [];

    async invalidate(providers: TextToImageProviderReconciliationRecord["discardedProviders"]) {
        this.calls.push(providers.map((provider) => provider.providerId));
        return [{projectPath: "workspace/book", configurationStale: 2, outcomeUnknown: 1}];
    }

    async invalidateRevision(target: TextToImageProviderRevisionInvalidationRecord) {
        this.revisionCalls.push({ownerUserId: target.ownerUserId, providerId: target.providerId, oldRevision: target.oldRevision});
        return [];
    }
}
