import {describe, expect, it} from "vitest";
import {
    assertPostprocessJobSucceeded,
    buildAssetRerollRequest,
    buildAssetSendRequest,
    parseAssetFinalBundle,
} from "nbook/server/text-to-image/asset-postprocess.service";

describe("asset postprocess send request", () => {
    it("只使用当前编辑后的基础配方，不重放历史 NovelAI 快照", () => {
        const request = buildAssetSendRequest({
            prompt: "1girl, silver hair",
            negativePrompt: "blurry, lowres",
            characterPrompts: [{prompt: "1girl, blue eyes", negativePrompt: "bad anatomy", centerX: 0.3, centerY: 0.5}],
            persistedRequest: {
                useFinalPrompt: true,
                novelAi: {
                    model: "nai-diffusion-4-5-full",
                    width: 1216,
                    height: 832,
                    seed: 42,
                },
            },
        });

        expect(request).toEqual({
            prompt: "1girl, silver hair",
            negativePrompt: "blurry, lowres",
            characterPrompts: [{prompt: "1girl, blue eyes", negativePrompt: "bad anatomy", centerX: 0.3, centerY: 0.5}],
            novelAi: {seed: -1},
        });
    });

    it("Tag 修改发送不读取历史最终 bundle", () => {
        const bundle = {
            version: 1 as const,
            modelFamily: "nai4" as const,
            basePositive: "style, 1girl",
            baseNegative: "blurry",
            characters: [{positive: "1girl", negative: "bad"}],
            actualInput: "style, 1girl",
            actualNegativeInput: "blurry",
            appliedRuleLines: [1],
        };
        const request = buildAssetSendRequest({
            prompt: "edited base prompt",
            negativePrompt: "source negative",
            persistedRequest: {useFinalPrompt: true, finalPromptBundle: bundle},
        });

        expect(request).toEqual({
            prompt: "edited base prompt",
            negativePrompt: "source negative",
            novelAi: {seed: -1},
        });
    });

    it("仍可读取历史 v1 bundle，同时接受新写入的 v2 bundle", () => {
        const base = {
            basePositive: "style, 1girl",
            baseNegative: "blurry",
            characters: [{positive: "1girl", negative: "bad"}],
            actualInput: "style, 1girl",
            actualNegativeInput: "blurry",
            appliedRuleLines: [1],
        };
        expect(parseAssetFinalBundle(JSON.stringify({version: 1, modelFamily: "nai4", ...base}))).toMatchObject({version: 1, modelFamily: "nai4"});
        expect(parseAssetFinalBundle(JSON.stringify({version: 2, modelFamily: "nai5", model: "nai-diffusion-5-full", ...base}))).toMatchObject({
            version: 2,
            modelFamily: "nai5",
            model: "nai-diffusion-5-full",
        });
    });

    it("reroll 从源 requestJson 的基础字段构造，不读取资产 prompt 或历史参数", () => {
        expect(buildAssetRerollRequest({
            sourceRequest: {
                prompt: "source base",
                negativePrompt: "source negative",
                characterPrompts: [{prompt: "slot", negativePrompt: "slot negative"}],
                novelAi: {model: "nai-diffusion-4-5-full", width: 1216},
                finalPromptBundle: {version: 1, modelFamily: "nai4", ...{
                    ...baseBundleForTest(),
                }},
            },
            generationRecipeId: "recipe-v5",
        })).toEqual({
            prompt: "source base",
            negativePrompt: "source negative",
            characterPrompts: [{prompt: "slot", negativePrompt: "slot negative"}],
            generationRecipeId: "recipe-v5",
            novelAi: {seed: -1},
        });
    });

    it("后处理 Job 失败时透传真实队列错误，不伪装成未找到图片", () => {
        expect(() => assertPostprocessJobSucceeded({
            status: "failed",
            errorMessage: "NovelAI 生成失败：HTTP 500：seed 无效",
        }, "job-1")).toThrow("NovelAI 生成失败：HTTP 500：seed 无效");
        expect(() => assertPostprocessJobSucceeded({
            status: "succeeded",
            errorMessage: null,
        }, "job-1")).not.toThrow();
    });
});

function baseBundleForTest() {
    return {
        basePositive: "old final",
        baseNegative: "old negative",
        characters: [],
        actualInput: "old final",
        actualNegativeInput: "old negative",
        appliedRuleLines: [],
    };
}
