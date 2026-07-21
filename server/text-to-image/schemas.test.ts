import {describe, expect, it} from "vitest";
import {TextToImageJobCreateSchema} from "nbook/server/text-to-image/schemas";

const baseJob = {
    projectPath: "workspace/book",
    providerId: 1,
    kind: "manual" as const,
    prompt: "1girl",
    negativePrompt: "",
    count: 1,
    recipeId: "default" as const,
    expectedRecipeSourceHash: "a".repeat(64),
};

describe("text-to-image job create boundary", () => {
    it("正文按钮不能直接创建 Job", () => {
        const parsed = TextToImageJobCreateSchema.safeParse({...baseJob, kind: "body"});

        expect(parsed.success).toBe(false);
    });

    it("文生图分页只能提交手工意图与 Recipe 身份", () => {
        const parsed = TextToImageJobCreateSchema.safeParse(baseJob);

        expect(parsed.success).toBe(true);
    });

    it("拒绝浏览器提交第二份 NovelAI 参数", () => {
        const parsed = TextToImageJobCreateSchema.safeParse({
            ...baseJob,
            novelAi: {
                model: "browser-model",
                sampler: "browser-sampler",
                seed: 123,
            },
        });

        expect(parsed.success).toBe(false);
    });

    it("拒绝浏览器在顶层覆盖 Recipe 执行字段", () => {
        expect(TextToImageJobCreateSchema.safeParse({...baseJob, model: "browser-model"}).success).toBe(false);
        expect(TextToImageJobCreateSchema.safeParse({...baseJob, seed: 123}).success).toBe(false);
        expect(TextToImageJobCreateSchema.safeParse({...baseJob, style: {positivePrefix: "browser-style"}}).success).toBe(false);
    });
});
