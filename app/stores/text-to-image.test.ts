import {createPinia, defineStore, setActivePinia} from "pinia";
import {computed, ref} from "vue";
import {beforeAll, beforeEach, describe, expect, it} from "vitest";

describe("useTextToImageStore", () => {
    beforeAll(() => {
        const globals = globalThis as typeof globalThis & Record<string, unknown>;
        globals.defineStore = defineStore;
        globals.ref = ref;
        globals.computed = computed;
        globals.piniaPluginPersistedstate = {
            localStorage: () => ({}),
        };
    });

    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("reuses an imported source character instead of duplicating it", async () => {
        const {useTextToImageStore} = await import("nbook/app/stores/text-to-image");
        const store = useTextToImageStore();
        store.setCurrentProjectPath("workspace/current-book");

        const first = store.addCharacterFromDraft({
            cnName: "Imported Character",
            enName: "Imported Character",
            profileTraits: "first draft",
            sourceProjectPath: "workspace/source-book",
            sourceCharacterPath: "characters/imported/index.md",
        });
        const second = store.addCharacterFromDraft({
            cnName: "Imported Character",
            enName: "Imported Character",
            profileTraits: "updated draft",
            sourceProjectPath: "workspace/source-book",
            sourceCharacterPath: "characters/imported/index.md",
        });

        expect(second.id).toBe(first.id);
        expect(store.characters).toHaveLength(1);
        expect(store.characters[0]?.profileTraits).toBe("updated draft");
    });

    it("removes large base64 image payloads from persisted NovelAI exchange snapshots", async () => {
        const {useTextToImageStore} = await import("nbook/app/stores/text-to-image");
        const store = useTextToImageStore();

        store.recordNovelAiExchange({
            imageCount: 1,
            warnings: [],
            request: {
                prompt: "tag",
                parameters: {
                    reference_image_multiple: [`data:image/png;base64,${"a".repeat(128)}`],
                    character_reference_image_multiple: ["b".repeat(128)],
                    nested: {
                        safe: "value",
                    },
                },
            },
        });

        const serialized = JSON.stringify(store.lastNovelAiExchange.request);
        expect(serialized).toContain("safe");
        expect(serialized).not.toContain("data:image/png;base64");
        expect(serialized).not.toContain("aaaaaaaaaaaaaaaa");
        expect(serialized).not.toContain("bbbbbbbbbbbbbbbb");
        expect(serialized).toContain("[omitted image payload");
    });
    it("normalizes generation batch size and removes a single generation result", async () => {
        const {useTextToImageStore} = await import("nbook/app/stores/text-to-image");
        const store = useTextToImageStore();

        store.updateGenerationDraft({batchSize: 9});
        expect(store.generationDraft.batchSize).toBe(4);
        store.updateGenerationDraft({batchSize: 0});
        expect(store.generationDraft.batchSize).toBe(1);

        const first = createGenerationResult("first");
        const second = createGenerationResult("second");
        store.prependGenerationResults([first, second]);
        store.removeGenerationResult(first.id);

        expect(store.generationResults.map((result) => result.id)).toEqual([second.id]);
    });

    it("loads current Project job summaries from the server without persisting them", async () => {
        const globals = globalThis as typeof globalThis & Record<string, unknown>;
        const requests: string[] = [];
        const fetchMock = async (url: string) => {
            requests.push(url);
            return {
                items: [{
                    id: "job-1",
                    providerId: 7,
                    kind: "manual",
                    status: "queued",
                    sourcePath: null,
                    sourceAnchorId: null,
                    sourceInsertStatus: "not_applicable",
                    resultAssetIds: [],
                    errorMessage: null,
                    attemptCount: 0,
                    createdAt: "2026-07-11T00:00:00.000Z",
                    startedAt: null,
                    finishedAt: null,
                }],
                page: 1,
                pageSize: 12,
                hasMore: false,
            };
        };
        (globals as Record<string, unknown>).$fetch = fetchMock;
        const {useTextToImageStore} = await import("nbook/app/stores/text-to-image");
        const store = useTextToImageStore();

        await store.refreshProjectJobs("workspace/current-book");

        expect(requests).toEqual(["/api/text-to-image/jobs?projectPath=workspace%2Fcurrent-book&pageSize=12"]);
        expect(store.projectJobs.map((job) => job.id)).toEqual(["job-1"]);
        expect(store.projectJobsProjectPath).toBe("workspace/current-book");
    });
});

function createGenerationResult(id: string) {
    return {
        id,
        createdAt: "2026-07-09T00:00:00.000Z",
        fileName: `${id}.png`,
        savedPath: "",
        dataUrl: "data:image/png;base64,AA==",
        mimeType: "image/png",
        byteLength: 1,
        seed: 1,
        width: 64,
        height: 64,
        model: "nai-diffusion-4-5-full",
        prompt: "tag",
        negativePrompt: "",
    };
}
