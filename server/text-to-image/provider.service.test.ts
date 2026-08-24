import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    TextToImageProviderCredentialRequiredError,
    TextToImageProviderMaskSentinelError,
    TextToImageProviderNotConfiguredError,
    TextToImageProviderService,
    type TextToImageProviderRecord,
    type TextToImageProviderStore,
} from "nbook/server/text-to-image/provider.service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

describe("TextToImageProviderService", () => {
    it("保存 Provider 时密封凭据并返回脱敏 DTO", async () => {
        const service = new TextToImageProviderService(new InMemoryProviderStore(), await createKeyPath());

        const provider = await service.save(7, {
            kind: "novelai",
            name: "NovelAI",
            baseUrl: "https://image.novelai.net",
            credential: "server-only-token",
            settings: {requestIntervalMs: 15_000},
        });

        expect(provider).toMatchObject({
            id: 1,
            kind: "novelai",
            name: "NovelAI",
            hasCredential: true,
        });
        expect(JSON.stringify(provider)).not.toContain("server-only-token");
        expect(JSON.stringify(provider)).not.toContain("credentialCiphertext");
        await expect(service.resolveCredential(7, provider.id)).resolves.toBe("server-only-token");
    });

    it("只在明文凭据变化时递增 credentialRevision", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        const provider = await service.save(7, {
            kind: "openai_compatible",
            name: "LLM",
            baseUrl: "https://api.example.com/v1",
            credential: "token-one",
            settings: {model: "gpt-4o"},
        });

        await service.save(7, {
            id: provider.id,
            kind: "openai_compatible",
            name: "LLM renamed",
            baseUrl: "https://api.example.com/v1",
            settings: {model: "gpt-4o"},
        });
        await expect(service.resolveCredential(7, provider.id)).resolves.toBe("token-one");
        expect(store.records[0]?.credentialRevision).toBe(1);

        await service.save(7, {
            id: provider.id,
            kind: "openai_compatible",
            name: "LLM renamed",
            baseUrl: "https://api.example.com/v1",
            credential: "token-one",
            settings: {model: "gpt-4o"},
        });
        expect(store.records[0]?.credentialRevision).toBe(1);

        await service.save(7, {
            id: provider.id,
            kind: "openai_compatible",
            name: "LLM renamed",
            baseUrl: "https://api.example.com/v1",
            credential: "token-two",
            settings: {model: "gpt-4o"},
        });
        expect(store.records[0]?.credentialRevision).toBe(2);
        await expect(service.resolveCredential(7, provider.id)).resolves.toBe("token-two");
    });

    it("settings 缺省时不覆盖已有配置", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        const provider = await service.save(7, {
            kind: "novelai",
            name: "NovelAI",
            baseUrl: "https://image.novelai.net",
            credential: "token",
            settings: {requestIntervalMs: 15_000},
        });

        await service.save(7, {
            id: provider.id,
            kind: "novelai",
            name: "NovelAI",
            baseUrl: "https://image.novelai.net",
        });

        expect(store.records[0]?.settings).toEqual({requestIntervalMs: 15_000});
    });

    it("NovelAI 无 id 时复用首个同类型 Provider 不新建", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        await service.save(7, {
            kind: "novelai",
            name: "NovelAI",
            baseUrl: "https://image.novelai.net",
            credential: "token",
            settings: {requestIntervalMs: 15_000},
        });

        await service.save(7, {
            kind: "novelai",
            name: "NovelAI 2",
            baseUrl: "https://image.novelai.net",
            settings: {requestIntervalMs: 20_000},
        });

        expect(store.records).toHaveLength(1);
        expect(store.records[0]).toMatchObject({name: "NovelAI 2", settings: {requestIntervalMs: 20_000}});
    });

    it("缺少完整凭据时拒绝读取并抛出稳定错误", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        const provider = await service.save(7, {
            kind: "novelai",
            name: "NovelAI",
            baseUrl: "https://image.novelai.net",
            credential: "server-only-token",
            settings: {},
        });
        store.records[0] = {
            ...store.records[0]!,
            credentialCiphertext: "",
            credentialIv: "",
            credentialTag: "",
        };

        await expect(service.resolveCredential(7, provider.id)).rejects.toBeInstanceOf(TextToImageProviderNotConfiguredError);
        await expect(service.resolveCredential(7, 999)).rejects.toBeInstanceOf(TextToImageProviderNotConfiguredError);
    });

    it("list 只返回当前 owner 的 Provider 且不暴露凭据", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        await service.save(7, {
            kind: "novelai",
            name: "NovelAI",
            baseUrl: "https://image.novelai.net",
            credential: "token",
            settings: {},
        });
        await service.save(8, {
            kind: "novelai",
            name: "Other",
            baseUrl: "https://image.novelai.net",
            credential: "other-token",
            settings: {},
        });

        const providers = await service.list(7);
        expect(providers).toHaveLength(1);
        expect(providers[0]).toMatchObject({name: "NovelAI", hasCredential: true});
        expect(JSON.stringify(providers)).not.toContain("token");
    });

    it("严格三态合同：preserve 不改变 Key，replace/delete 各自递增 revision", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        const provider = await service.save(7, {
            kind: "novelai", name: "NovelAI", baseUrl: "https://image.novelai.net",
            credentialUpdate: {mode: "replace", value: "token-a"},
            settings: {requestIntervalMs: 15_000},
        });
        await service.save(7, {id: provider.id, kind: "novelai", name: "NovelAI", baseUrl: provider.baseUrl, credentialUpdate: {mode: "preserve"}});
        expect(store.records[0]?.credentialRevision).toBe(1);
        await expect(service.resolveCredential(7, provider.id)).resolves.toBe("token-a");

        await service.save(7, {id: provider.id, kind: "novelai", name: "NovelAI", baseUrl: provider.baseUrl, credentialUpdate: {mode: "replace", value: "token-b"}});
        expect(store.records[0]?.credentialRevision).toBe(2);
        await expect(service.resolveCredential(7, provider.id)).resolves.toBe("token-b");

        const deleted = await service.deleteCredential(7, provider.id);
        expect(deleted.hasCredential).toBe(false);
        expect(store.records[0]).toMatchObject({name: "NovelAI", settings: {requestIntervalMs: 15_000}});
        expect(store.records[0]?.credentialRevision).toBe(3);
        await expect(service.resolveCredential(7, provider.id)).rejects.toBeInstanceOf(TextToImageProviderNotConfiguredError);
    });

    it("新建 Provider 必须 replace，遮罩哨兵拒绝为真实 Key", async () => {
        const service = new TextToImageProviderService(new InMemoryProviderStore(), await createKeyPath());
        await expect(service.save(7, {kind: "novelai", name: "NovelAI", baseUrl: "https://image.novelai.net", credentialUpdate: {mode: "preserve"}}))
            .rejects.toBeInstanceOf(TextToImageProviderCredentialRequiredError);
        await expect(service.save(7, {kind: "novelai", name: "NovelAI", baseUrl: "https://image.novelai.net", credentialUpdate: {mode: "replace", value: "········"}}))
            .rejects.toBeInstanceOf(TextToImageProviderMaskSentinelError);
    });

    it("resolveRuntimeProvider 返回 revision 供队列消费校验", async () => {
        const service = new TextToImageProviderService(new InMemoryProviderStore(), await createKeyPath());
        const provider = await service.save(7, {kind: "novelai", name: "NovelAI", baseUrl: "https://image.novelai.net", credential: "token"});
        await expect(service.resolveRuntimeProvider(7, provider.id)).resolves.toMatchObject({credential: "token", credentialRevision: 1});
    });

    it("切换活动画风串只更新 activeGenerationRecipeId，不覆盖其它已保存设置", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        const provider = await service.save(7, {
            kind: "novelai",
            name: "NovelAI",
            baseUrl: "https://image.novelai.net",
            credential: "token",
            settings: {
                baseUrl: "https://image.novelai.net",
                model: "nai-diffusion-4-5-full",
                promptGuidance: 6,
                activeGenerationRecipeId: "recipe-a",
                generationRecipes: {
                    "recipe-a": {model: "nai-diffusion-4-5-full"},
                    "recipe-b": {model: "nai-diffusion-5-full"},
                },
            },
        });

        const switched = await service.setActiveGenerationRecipe(7, provider.id, "recipe-b");

        expect(switched.settings).toMatchObject({
            model: "nai-diffusion-4-5-full",
            promptGuidance: 6,
            activeGenerationRecipeId: "recipe-b",
        });
        expect(store.records[0]?.settings).toMatchObject({
            model: "nai-diffusion-4-5-full",
            promptGuidance: 6,
            activeGenerationRecipeId: "recipe-b",
        });
        const current = await service.resolveCurrentNovelAiProvider(7);
        expect(current).toMatchObject({
            providerId: provider.id,
            providerOwnerUserId: 7,
            generationRecipeId: "recipe-b",
        });
        expect(JSON.parse(current.providerSnapshotJson)).toMatchObject({
            providerId: provider.id,
            activeGenerationRecipeId: "recipe-b",
            settings: {
                model: "nai-diffusion-4-5-full",
                activeGenerationRecipeId: "recipe-b",
            },
        });
        expect(current.providerSnapshotJson).not.toContain("token");
    });
});

class InMemoryProviderStore implements TextToImageProviderStore {
    records: TextToImageProviderRecord[] = [];
    private nextId = 1;

    async list(ownerUserId: number): Promise<TextToImageProviderRecord[]> {
        return this.records.filter((record) => record.ownerUserId === ownerUserId);
    }

    async find(ownerUserId: number, id: number): Promise<TextToImageProviderRecord | null> {
        return this.records.find((record) => record.ownerUserId === ownerUserId && record.id === id) ?? null;
    }

    async create(input: Omit<TextToImageProviderRecord, "id" | "createdAt" | "updatedAt">): Promise<TextToImageProviderRecord> {
        const record: TextToImageProviderRecord = {
            ...input,
            id: this.nextId++,
            createdAt: new Date("2026-08-03T00:00:00.000Z"),
            updatedAt: new Date("2026-08-03T00:00:00.000Z"),
        };
        this.records.push(record);
        return record;
    }

    async update(
        ownerUserId: number,
        id: number,
        update: Partial<Omit<TextToImageProviderRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">>,
    ): Promise<TextToImageProviderRecord | null> {
        const index = this.records.findIndex((record) => record.ownerUserId === ownerUserId && record.id === id);
        if (index < 0) return null;
        this.records[index] = {
            ...this.records[index]!,
            ...update,
            updatedAt: new Date("2026-08-03T00:00:01.000Z"),
        };
        return this.records[index]!;
    }

    async delete(ownerUserId: number, id: number): Promise<boolean> {
        const index = this.records.findIndex((record) => record.ownerUserId === ownerUserId && record.id === id);
        if (index < 0) return false;
        this.records.splice(index, 1);
        return true;
    }
}

async function createKeyPath(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "nbook-tti-provider-"));
    temporaryDirectories.push(directory);
    return path.join(directory, "text-to-image.key");
}
