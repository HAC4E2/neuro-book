import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => {
    class ManualReferencesUnsupportedError extends Error {
        readonly code = "TEXT_TO_IMAGE_MANUAL_REFERENCES_UNSUPPORTED";
        constructor() {
            super("手工生成不支持参考资产，请在插图执行流程中使用 Recipe 参考资源。");
            this.name = "TextToImageManualReferencesUnsupportedError";
        }
    }
    class RecipeConflictError extends Error {
        readonly code = "TEXT_TO_IMAGE_RECIPE_CONFLICT";
        constructor() {
            super("Recipe 已被其他入口修改。");
            this.name = "TextToImageRecipeConflictError";
        }
    }
    class RecipeInvalidError extends Error {
        readonly code = "TEXT_TO_IMAGE_RECIPE_INVALID";
        readonly fileContentHash: string | null = null;
        constructor() {
            super("Recipe Markdown 无法通过严格校验。");
            this.name = "TextToImageRecipeInvalidError";
        }
    }
    class RecipeNotConfiguredError extends Error {
        readonly code = "TEXT_TO_IMAGE_RECIPE_NOT_CONFIGURED";
        constructor() {
            super("当前 Project 尚未保存文生图 Recipe。");
            this.name = "TextToImageRecipeNotConfiguredError";
        }
    }
    return {
        compileManual: vi.fn(),
        enqueue: vi.fn(),
        ManualReferencesUnsupportedError,
        RecipeConflictError,
        RecipeInvalidError,
        RecipeNotConfiguredError,
    };
});

vi.mock("nbook/server/text-to-image/recipe.service", () => ({
    TextToImageRecipeService: class {
        compileManual = mocks.compileManual;
    },
    TextToImageManualReferencesUnsupportedError: mocks.ManualReferencesUnsupportedError,
    TextToImageRecipeConflictError: mocks.RecipeConflictError,
    TextToImageRecipeInvalidError: mocks.RecipeInvalidError,
    TextToImageRecipeNotConfiguredError: mocks.RecipeNotConfiguredError,
}));

vi.mock("nbook/server/text-to-image/queue.service", () => ({
    createTextToImageQueueService: vi.fn(() => ({
        enqueue: mocks.enqueue,
    })),
}));

describe("POST /api/text-to-image/jobs", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("readBody", async (event: {body?: unknown}) => event.body);
        mocks.compileManual.mockReset();
        mocks.compileManual.mockImplementation(async () => {
            throw new Error("compileManual 默认 stub");
        });
        mocks.enqueue.mockReset();
        mocks.enqueue.mockImplementation(async () => ({jobId: "job-1", status: "queued"}));
    });

    it("手工生成携带参考资源的 Recipe 通过共享 mapper 映射为稳定 422", async () => {
        mocks.compileManual.mockImplementation(async () => {
            throw new mocks.ManualReferencesUnsupportedError();
        });
        const handler = (await import("nbook/server/api/text-to-image/jobs/index.post")).default;

        await expect(handler({
            method: "POST",
            body: {
                projectPath: "workspace/demo",
                providerId: 11,
                kind: "manual",
                prompt: "rain",
                negativePrompt: "lowres",
                count: 1,
                recipeId: "default",
                expectedRecipeSourceHash: "a".repeat(64),
            },
        } as never)).rejects.toMatchObject({
            statusCode: 422,
            data: {code: "TEXT_TO_IMAGE_MANUAL_REFERENCES_UNSUPPORTED"},
        });
        expect(mocks.compileManual).toHaveBeenCalledWith(expect.objectContaining({projectPath: "workspace/demo"}));
    });

    it("参考自由的 Recipe 编译成功并进入 queue", async () => {
        mocks.compileManual.mockImplementation(async (input) => ({
            prompt: input.prompt,
            negativePrompt: input.negativePrompt,
            novelAi: {model: "nai-diffusion-4-5-full", seed: 1, count: input.count},
            style: {
                positivePrefix: "",
                positiveSuffix: "",
                negativePrefix: "",
                negativeSuffix: "",
                useFurryDataset: false,
                positiveQualityPreset: true,
                negativeQualityPreset: "none",
            },
            recipeSnapshot: {model: "nai-diffusion-4-5-full", recipeSourceHash: "a".repeat(64)},
        }));
        const handler = (await import("nbook/server/api/text-to-image/jobs/index.post")).default;

        await expect(handler({
            method: "POST",
            body: {
                projectPath: "workspace/demo",
                providerId: 11,
                kind: "manual",
                prompt: "rain",
                negativePrompt: "lowres",
                count: 2,
                recipeId: "default",
                expectedRecipeSourceHash: "a".repeat(64),
            },
        } as never)).resolves.toMatchObject({jobId: "job-1"});
        expect(mocks.enqueue).toHaveBeenCalledOnce();
    });

    it("body 缺少必填字段时在调用 service 前拒绝", async () => {
        const handler = (await import("nbook/server/api/text-to-image/jobs/index.post")).default;

        await expect(handler({
            method: "POST",
            body: {projectPath: "workspace/demo"},
        } as never)).rejects.toMatchObject({statusCode: 400});
        expect(mocks.compileManual).not.toHaveBeenCalled();
    });
});
