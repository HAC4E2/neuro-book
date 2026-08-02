import {createPinia, defineStore, setActivePinia} from "pinia";
import {computed, ref, watch} from "vue";
import {beforeAll, beforeEach, describe, expect, it} from "vitest";
import {createDefaultTextToImageRecipeSource} from "nbook/shared/text-to-image-recipe";

describe("useTextToImageStore", () => {
    beforeAll(() => {
        const globals = globalThis as typeof globalThis & Record<string, unknown>;
        globals.defineStore = defineStore;
        globals.ref = ref;
        globals.computed = computed;
        globals.watch = watch;
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

    it("loads and explicitly saves the Project Recipe without persisting a browser copy", async () => {
        const globals = globalThis as typeof globalThis & Record<string, unknown>;
        const requests: Array<{url: string; options?: {method?: string; body?: object}}> = [];
        const source = {
            ...createDefaultTextToImageRecipeSource(),
            model: "recipe-model",
            steps: 31,
            styles: [{
                ...createDefaultTextToImageRecipeSource().styles[0],
                positivePrefix: "cinematic",
            }],
            activeStyleId: "recipe-default",
        };
        const snapshot = {...source, planningConstraintsHash: "a".repeat(64), recipeSourceHash: "b".repeat(64)};
        const fetchMock = async (url: string, options?: {method?: string; body?: object}) => {
            requests.push({url, options});
            if (url === "/api/text-to-image/providers/novelai") {
                return {state: "unconfigured", provider: null, candidates: [], recipeMigrationModels: []};
            }
            return {exists: true, source, snapshot};
        };
        Reflect.set(globals, "$fetch", fetchMock);
        const {useTextToImageStore} = await import("nbook/app/stores/text-to-image");
        const store = useTextToImageStore();

        await store.loadRecipe("workspace/current-book");
        expect(store.novelAi).toMatchObject({model: "recipe-model", steps: 31});
        expect(store.activeStyle).toMatchObject({positivePrefix: "cinematic"});
        expect(store.recipeDirty).toBe(false);

        store.updateNovelAiSettings({steps: 33});
        expect(store.recipeDirty).toBe(true);
        await store.saveRecipe("workspace/current-book");

        expect(requests[2]).toMatchObject({
            url: "/api/text-to-image/recipes/default",
            options: {
                method: "PUT",
                body: {
                    projectPath: "workspace/current-book",
                    expectedRecipeSourceHash: "b".repeat(64),
                    source: {model: "recipe-model", steps: 33},
                },
            },
        });
        expect(JSON.stringify(requests[2]?.options?.body)).not.toContain("token");
    });

    it("setInpaint 原子写入双资产；不存在单蒙版 mutation", async () => {
        const {useTextToImageStore} = await import("nbook/app/stores/text-to-image");
        const store = useTextToImageStore();
        store.setCurrentProjectPath("workspace/current-book");
        // 触发 ensureRecipeReferences 初始化默认 source。
        store.addVibeReference("a".repeat(64), 0.6, 0.5);
        expect(store.recipeReferences.inpaint).toBeNull();

        store.setInpaint({baseImageContentHash: "b".repeat(64), maskContentHash: "c".repeat(64)});

        expect(store.recipeReferences.inpaint).toEqual({
            baseImageContentHash: "b".repeat(64),
            maskContentHash: "c".repeat(64),
        });
        // 原子对：绝不存在只写蒙版或只写底图的入口。
        expect(store as unknown as Record<string, unknown>).not.toHaveProperty("setInpaintMask");
        expect(store as unknown as Record<string, unknown>).not.toHaveProperty("setInpaintBase");
    });

    it("clearInpaint（removeInpaint）把 Inpaint 引用恢复为 null", async () => {
        const {useTextToImageStore} = await import("nbook/app/stores/text-to-image");
        const store = useTextToImageStore();
        store.setCurrentProjectPath("workspace/current-book");
        store.setInpaint({baseImageContentHash: "b".repeat(64), maskContentHash: "c".repeat(64)});

        store.removeInpaint();

        expect(store.recipeReferences.inpaint).toBeNull();
    });

    it("addVibeReference 只改内存 Recipe，不触发任何写盘调用", async () => {
        const {useTextToImageStore} = await import("nbook/app/stores/text-to-image");
        const {vi} = await import("vitest");
        const requests: Array<{url: string; options: {method?: string; body?: unknown}}> = [];
        vi.stubGlobal("$fetch", vi.fn(async (url: string, options: {method?: string; body?: unknown}) => {
            requests.push({url, options});
            return {};
        }));
        const store = useTextToImageStore();
        store.setCurrentProjectPath("workspace/current-book");

        store.addVibeReference("d".repeat(64), 0.6, 0.5);

        expect(store.recipeReferences.vibeReferences).toEqual([{
            contentHash: "d".repeat(64),
            strength: 0.6,
            informationExtracted: 0.5,
        }]);
        // 仅 addVibeReference：无网络写盘；只有显式 saveRecipe 才持久化 Recipe。
        expect(requests).toHaveLength(0);
        vi.unstubAllGlobals();
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
