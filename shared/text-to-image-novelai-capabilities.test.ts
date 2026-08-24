import {describe, expect, it} from "vitest";
import {
    getNovelAiModelCapabilities,
    isNovelAiNoiseScheduleSupported,
    isNovelAiSamplerSupported,
} from "nbook/shared/text-to-image-novelai-capabilities";

describe("NovelAI model capabilities", () => {
    it("V5 允许 native 和 DDIM，且使用非 V4.5 sigma family", () => {
        const capabilities = getNovelAiModelCapabilities("nai-diffusion-5-full");

        expect(capabilities).toMatchObject({family: "nai5", paramsVersion: 4, supportsVariety: true, varietySigmaFamily: "v4"});
        expect(isNovelAiNoiseScheduleSupported("nai-diffusion-5-full", "native")).toBe(true);
        expect(isNovelAiSamplerSupported("nai-diffusion-5-curated", "ddim_v3")).toBe(true);
    });

    it("V5 禁止 Vibe/角色参考，V4.5 保留两类参考能力", () => {
        expect(getNovelAiModelCapabilities("nai-diffusion-5-curated")).toMatchObject({
            supportsVibe: false,
            supportsCharacterReference: false,
        });
        expect(getNovelAiModelCapabilities("nai-diffusion-4-5-full")).toMatchObject({
            supportsVibe: true,
            supportsCharacterReference: true,
        });
    });
});
