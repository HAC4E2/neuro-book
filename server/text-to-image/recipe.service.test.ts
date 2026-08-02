import {beforeEach, describe, expect, it, vi} from "vitest";
import {createDefaultTextToImageRecipeSource} from "nbook/shared/text-to-image-recipe";
import {
    TextToImageRecipeConflictError,
    TextToImageRecipeInvalidError,
    TextToImageRecipeService,
    TextToImageManualReferencesUnsupportedError,
    type TextToImageRecipeFileStore,
} from "nbook/server/text-to-image/recipe.service";
import {DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH} from "nbook/server/text-to-image/recipe.codec";

// Recipe save 现在与 Manifest registration 共享 Project mutation 锁；单元测试用 identity 替换。
vi.mock("nbook/server/text-to-image/reference-asset-lock", () => ({
    withTextToImageReferenceMutationLock: async <T>(_projectPath: string, operation: () => Promise<T>): Promise<T> => operation(),
    assertTextToImageReferenceMutationScope: (): void => undefined,
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe("TextToImageRecipeService", () => {
    it("缺少 Recipe 时只返回未持久化默认草稿，不写 Project Workspace", async () => {
        const store = new MemoryRecipeFileStore();
        const service = new TextToImageRecipeService(store);

        const result = await service.read("workspace/novel-1");

        expect(result.exists).toBe(false);
        expect(result.source).toEqual(createDefaultTextToImageRecipeSource());
        expect(result.snapshot.recipeSourceHash).toMatch(/^[a-f0-9]{64}$/u);
        expect(store.writes).toEqual([]);
        expect(store.assertedRoots).toEqual(["workspace/novel-1"]);
    });

    it("首开自动落盘：缺失时持久化默认草稿，已存在时不重复写", async () => {
        const store = new MemoryRecipeFileStore();
        const service = new TextToImageRecipeService(store);

        const first = await service.ensurePersistedDefault("workspace/novel-1");
        const second = await service.ensurePersistedDefault("workspace/novel-1");

        expect(first.exists).toBe(true);
        expect(first.source).toEqual(createDefaultTextToImageRecipeSource());
        expect(second.exists).toBe(true);
        expect(store.writes).toHaveLength(1);
    });

    it("首开自动落盘对无效现存文件保持 fail-closed，不做覆盖", async () => {
        const store = new MemoryRecipeFileStore();
        const service = new TextToImageRecipeService(store);
        await service.save({
            projectPath: "workspace/novel-1",
            source: createDefaultTextToImageRecipeSource(),
            expectedRecipeSourceHash: null,
        });
        store.externalEdit(() => "not: [valid recipe");

        await expect(service.ensurePersistedDefault("workspace/novel-1")).rejects.toBeInstanceOf(TextToImageRecipeInvalidError);
        expect(store.writes).toHaveLength(1);
    });

    it("规范保存并从同一 Project Recipe 文件读回", async () => {
        const store = new MemoryRecipeFileStore();
        const service = new TextToImageRecipeService(store);
        const source = {
            ...createDefaultTextToImageRecipeSource(),
            title: "电影感默认配方",
            sampler: "k_dpmpp_2m",
        };

        const saved = await service.save({
            projectPath: "workspace/novel-1",
            source,
            expectedRecipeSourceHash: null,
        });
        const reloaded = await service.read("workspace/novel-1");

        expect(saved.exists).toBe(true);
        expect(reloaded.source).toEqual(source);
        expect(store.writes).toHaveLength(1);
        expect(store.writes[0]).toMatchObject({
            root: "workspace/novel-1",
            filePath: DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH,
            knownBefore: null,
        });
        expect(store.invalidatedRoots).toEqual(["workspace/novel-1"]);
    });

    it("保存时 Recipe source hash 已变化则稳定返回冲突", async () => {
        const store = new MemoryRecipeFileStore();
        const service = new TextToImageRecipeService(store);
        const initial = await service.save({
            projectPath: "workspace/novel-1",
            source: createDefaultTextToImageRecipeSource(),
            expectedRecipeSourceHash: null,
        });
        store.externalEdit((markdown) => markdown.replace("steps: 28", "steps: 30"));

        await expect(service.save({
            projectPath: "workspace/novel-1",
            source: {...initial.source, title: "用户草稿"},
            expectedRecipeSourceHash: initial.snapshot.recipeSourceHash,
        })).rejects.toBeInstanceOf(TextToImageRecipeConflictError);
        expect(store.writes).toHaveLength(1);
    });

    it("两个并发保存使用同一 source hash 时只允许一个成功", async () => {
        const store = new MemoryRecipeFileStore(true);
        const firstService = new TextToImageRecipeService(store);
        const secondService = new TextToImageRecipeService(store);
        const initial = await firstService.save({
            projectPath: "workspace/novel-1",
            source: createDefaultTextToImageRecipeSource(),
            expectedRecipeSourceHash: null,
        });
        const results = await Promise.allSettled([
            firstService.save({
                projectPath: "workspace/novel-1",
                source: {...initial.source, title: "并发草稿 A"},
                expectedRecipeSourceHash: initial.snapshot.recipeSourceHash,
            }),
            secondService.save({
                projectPath: "workspace/novel-1",
                source: {...initial.source, title: "并发草稿 B"},
                expectedRecipeSourceHash: initial.snapshot.recipeSourceHash,
            }),
        ]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        expect(results.find((result) => result.status === "rejected")).toMatchObject({
            reason: {code: "TEXT_TO_IMAGE_RECIPE_CONFLICT"},
        });
    });

    it("只从已保存的 Recipe 编译手工 Job snapshot", async () => {
        const store = new MemoryRecipeFileStore();
        const service = new TextToImageRecipeService(store);
        const source = {
            ...createDefaultTextToImageRecipeSource(),
            model: "recipe-owned-model",
            seed: {policy: "fixed" as const, fixed: 42},
            advanced: {
                ...createDefaultTextToImageRecipeSource().advanced,
                variety: true,
                smeaMode: "on" as const,
            },
            styles: [{
                ...createDefaultTextToImageRecipeSource().styles[0],
                positivePrefix: "cinematic light",
                negativeSuffix: "bad anatomy",
            }],
            activeStyleId: "recipe-default",
        };
        const saved = await service.save({
            projectPath: "workspace/novel-1",
            source,
            expectedRecipeSourceHash: null,
        });

        const compiled = await service.compileManual({
            projectPath: "workspace/novel-1",
            prompt: "sunlit room",
            negativePrompt: "lowres",
            count: 2,
            expectedRecipeSourceHash: saved.snapshot.recipeSourceHash,
        });

        expect(compiled).toMatchObject({
            prompt: "sunlit room",
            negativePrompt: "lowres",
            novelAi: {
                model: "recipe-owned-model",
                seed: 42,
                count: 2,
                variety: true,
                smeaMode: "on",
            },
            style: {
                positivePrefix: "cinematic light",
                negativeSuffix: "bad anatomy",
            },
            recipeSnapshot: {
                recipeSourceHash: saved.snapshot.recipeSourceHash,
            },
        });
        expect(store.writes).toHaveLength(1);
    });

    it("Recipe 含参考选择时手工编译被稳定拒绝", async () => {
        const store = new MemoryRecipeFileStore();
        const service = new TextToImageRecipeService(store);
        const source = {
            ...createDefaultTextToImageRecipeSource(),
            references: {
                normalizeVibeStrengths: true,
                vibeReferences: [{contentHash: "a".repeat(64), strength: 0.6, informationExtracted: 0.5}],
                characterReferences: [],
                inpaint: null,
            },
        };
        const saved = await service.save({
            projectPath: "workspace/novel-1",
            source,
            expectedRecipeSourceHash: null,
        });

        await expect(service.compileManual({
            projectPath: "workspace/novel-1",
            prompt: "sunlit room",
            negativePrompt: "",
            count: 1,
            expectedRecipeSourceHash: saved.snapshot.recipeSourceHash,
        })).rejects.toBeInstanceOf(TextToImageManualReferencesUnsupportedError);
    });

    it("未显式保存 Recipe 时拒绝创建 Job", async () => {
        const service = new TextToImageRecipeService(new MemoryRecipeFileStore());

        await expect(service.compileManual({
            projectPath: "workspace/novel-1",
            prompt: "sunlit room",
            negativePrompt: "",
            count: 1,
            expectedRecipeSourceHash: "a".repeat(64),
        })).rejects.toMatchObject({code: "TEXT_TO_IMAGE_RECIPE_NOT_CONFIGURED"});
    });

    it("random seed 在编译 Job 时解析为一次性具体值", async () => {
        const store = new MemoryRecipeFileStore();
        const service = new TextToImageRecipeService(store);
        const saved = await service.save({
            projectPath: "workspace/novel-1",
            source: createDefaultTextToImageRecipeSource(),
            expectedRecipeSourceHash: null,
        });

        const compiled = await service.compileManual({
            projectPath: "workspace/novel-1",
            prompt: "sunlit room",
            negativePrompt: "",
            count: 1,
            expectedRecipeSourceHash: saved.snapshot.recipeSourceHash,
        });

        expect(compiled.recipeSnapshot.seed).toEqual({policy: "random", fixed: 0});
        expect(compiled.novelAi.seed).toBeGreaterThanOrEqual(0);
        expect(compiled.novelAi.seed).toBeLessThanOrEqual(4_294_967_295);
        expect(compiled.novelAi.seed).not.toBe(-1);
    });

    it("无效 Recipe 返回稳定错误，并只允许携带原文件 hash 显式修复", async () => {
        const store = new MemoryRecipeFileStore();
        const service = new TextToImageRecipeService(store);
        store.setRaw("---\ntype: instruction\n---\nnot: a recipe\n");

        const invalid = await service.read("workspace/novel-1").catch((error: TextToImageRecipeInvalidError) => error);
        expect(invalid).toMatchObject({
            code: "TEXT_TO_IMAGE_RECIPE_INVALID",
            fileContentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        });
        await expect(service.save({
            projectPath: "workspace/novel-1",
            source: createDefaultTextToImageRecipeSource(),
            expectedRecipeSourceHash: null,
        })).rejects.toMatchObject({code: "TEXT_TO_IMAGE_RECIPE_INVALID"});

        await expect(service.save({
            projectPath: "workspace/novel-1",
            source: createDefaultTextToImageRecipeSource(),
            expectedRecipeSourceHash: null,
            expectedInvalidSourceHash: invalid.fileContentHash,
        })).resolves.toMatchObject({exists: true});
    });

    it("V4 Recipe 拒绝显示为有效但不会进入请求的手动 SMEA/Dyn", async () => {
        const service = new TextToImageRecipeService(new MemoryRecipeFileStore());

        await expect(service.save({
            projectPath: "workspace/novel-1",
            source: {
                ...createDefaultTextToImageRecipeSource(),
                advanced: {
                    ...createDefaultTextToImageRecipeSource().advanced,
                    smeaMode: "on",
                    smeaDyn: true,
                },
            },
            expectedRecipeSourceHash: null,
        })).rejects.toMatchObject({code: "TEXT_TO_IMAGE_RECIPE_INVALID"});
    });
});

class MemoryRecipeFileStore implements TextToImageRecipeFileStore {
    private markdown: string | null = null;
    readonly assertedRoots: string[] = [];
    readonly invalidatedRoots: string[] = [];
    readonly writes: Array<{root: string; projectPath: string; filePath: string; content: string; knownBefore: string | null}> = [];

    constructor(private readonly delayWrites = false) {}

    async resolveProjectRoot(projectPath: string): Promise<string> {
        return projectPath;
    }

    assertProjectOpen(root: string): void {
        this.assertedRoots.push(root);
    }

    async read(root: string, filePath: string): Promise<string | null> {
        expect(root).toBe("workspace/novel-1");
        expect(filePath).toBe(DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH);
        return this.markdown;
    }

    async write(input: {root: string; projectPath: string; filePath: string; content: string; knownBefore: string | null}): Promise<void> {
        if (this.delayWrites) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        this.writes.push(input);
        this.markdown = input.content;
    }

    invalidate(root: string, projectPath: string): void {
        this.invalidatedRoots.push(root);
    }

    externalEdit(transform: (markdown: string) => string): void {
        if (this.markdown === null) {
            throw new Error("测试 Recipe 尚未写入");
        }
        this.markdown = transform(this.markdown);
    }

    setRaw(markdown: string): void {
        this.markdown = markdown;
    }
}
