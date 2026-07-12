import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    TextToImageProviderService,
    type TextToImageProviderRecord,
    type TextToImageProviderStore,
} from "nbook/server/text-to-image/provider.service";

const temporaryDirectories: string[] = [];

describe("TextToImageProviderService", () => {
    afterEach(async () => {
        await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
            await rm(directory, {recursive: true, force: true});
        }));
    });

    it("creates an owner-scoped provider without exposing its credential", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());

        const provider = await service.create(7, {
            kind: "openai_compatible",
            name: "Prompt LLM",
            baseUrl: "https://llm.example/v1",
            model: "prompt-model",
            settings: {allowPrivateNetwork: false, requestIntervalMs: 250},
            credential: "server-only-token",
        });

        expect(provider).toEqual({
            id: 1,
            kind: "openai_compatible",
            name: "Prompt LLM",
            baseUrl: "https://llm.example/v1",
            model: "prompt-model",
            settings: {allowPrivateNetwork: false, requestIntervalMs: 250},
            hasCredential: true,
            createdAt: "2026-07-10T00:00:00.000Z",
            updatedAt: "2026-07-10T00:00:00.000Z",
        });
        expect(store.records[0]).not.toHaveProperty("credential");
        expect(store.records[0]?.credentialCiphertext).not.toBe("server-only-token");
    });

    it("keeps an omitted credential and blocks cross-owner reads", async () => {
        const store = new InMemoryProviderStore();
        const service = new TextToImageProviderService(store, await createKeyPath());
        const created = await service.create(7, providerInput());

        await service.update(7, created.id, {name: "Renamed provider"});

        await expect(service.resolveCredential(8, created.id)).rejects.toThrow();
        await expect(service.resolveCredential(7, created.id)).resolves.toMatchObject({
            provider: {name: "Renamed provider", hasCredential: true},
            credential: "server-only-token",
        });
    });

    it("rejects private base URLs unless the provider opts in", async () => {
        const service = new TextToImageProviderService(new InMemoryProviderStore(), await createKeyPath());

        await expect(service.create(7, {
            ...providerInput(),
            baseUrl: "http://127.0.0.1/v1",
        })).rejects.toThrow();
    });

    it("forces NovelAI providers to the official image endpoint", async () => {
        const service = new TextToImageProviderService(new InMemoryProviderStore(), await createKeyPath());

        const provider = await service.create(7, {
            ...providerInput(),
            kind: "novelai",
            name: "NovelAI",
            baseUrl: "https://attacker.example",
        });

        expect(provider.baseUrl).toBe("https://image.novelai.net");
    });
});

function providerInput() {
    return {
        kind: "openai_compatible" as const,
        name: "Prompt LLM",
        baseUrl: "https://llm.example/v1",
        model: "prompt-model",
        settings: {allowPrivateNetwork: false, requestIntervalMs: 250},
        credential: "server-only-token",
    };
}

async function createKeyPath(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "nbook-text-to-image-provider-"));
    temporaryDirectories.push(directory);
    return path.join(directory, "workspace", ".nbook", "secrets", "text-to-image.key");
}

class InMemoryProviderStore implements TextToImageProviderStore {
    records: TextToImageProviderRecord[] = [];

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
}
