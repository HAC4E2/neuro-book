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
});
