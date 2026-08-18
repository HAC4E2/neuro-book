import {describe, expect, it} from "vitest";
import {buildAssetSendRequest} from "nbook/server/text-to-image/asset-postprocess.service";

describe("asset postprocess send request", () => {
    it("uses the pending prompt while preserving the asset negative prompt and NovelAI snapshot", () => {
        const request = buildAssetSendRequest({
            prompt: "1girl, silver hair",
            negativePrompt: "blurry, lowres",
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
            useFinalPrompt: true,
            novelAi: {
                model: "nai-diffusion-4-5-full",
                width: 1216,
                height: 832,
                seed: -1,
            },
        });
    });

    it("历史最终 bundle 优先于资产 prompt，角色槽继续保留", () => {
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
            prompt: "stale prompt",
            negativePrompt: "stale negative",
            persistedRequest: {useFinalPrompt: true, finalPromptBundle: bundle},
        });

        expect(request).toMatchObject({
            prompt: "style, 1girl",
            negativePrompt: "blurry",
            useFinalPrompt: true,
            finalPromptBundle: bundle,
        });
    });
});
