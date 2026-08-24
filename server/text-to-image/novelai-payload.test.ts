import {describe, expect, it} from "vitest";
import {
    buildNovelAiReferencePayload,
    resolveNovelAiModelFamily,
    validateNovelAiPayload,
} from "nbook/server/text-to-image/novelai-payload";

describe("NovelAI payload adapter", () => {
    it("接受 NAI V5/V4.5 Full/Curated 模型", () => {
        expect(resolveNovelAiModelFamily("nai-diffusion-5-full")).toBe("nai5");
        expect(resolveNovelAiModelFamily("nai-diffusion-5-curated")).toBe("nai5");
        expect(resolveNovelAiModelFamily("nai-diffusion-4-5-full")).toBe("nai45");
        expect(resolveNovelAiModelFamily("nai-diffusion-4-5-curated")).toBe("nai45");
        expect(() => resolveNovelAiModelFamily("nai-diffusion-3")).toThrow(/V5\/V4\.5/u);
        expect(() => resolveNovelAiModelFamily("nai-diffusion-4-full")).toThrow(/V5\/V4\.5/u);
    });

    it("NAI4.5 使用 cached Vibe 数组", () => {
        const refs = {
            vibe: [{encodingBase64: "vibe", strength: 0.6, informationExtracted: 0.3}],
            character: [],
        };
        expect(buildNovelAiReferencePayload("nai45", refs)).toMatchObject({
            reference_image_multiple_cached: [{data: "vibe"}],
            reference_strength_multiple: [0.6],
        });
    });

    it("NAI4.5 接受五组角色参考数组", () => {
        const refs = {
            vibe: [],
            character: [{imageBase64: "char", strength: 0.7, informationExtracted: 1}],
        };
        expect(buildNovelAiReferencePayload("nai45", refs)).toMatchObject({
            director_reference_images_cached: [{data: "char"}],
            director_reference_descriptions: [{caption: {base_caption: "character"}}],
            director_reference_information_extracted: [1],
            director_reference_strength_values: [0.7],
            director_reference_secondary_strength_values: [0.3],
        });
    });

    it("V5 首发版拒绝 Vibe 与角色参考图字段", () => {
        expect(() => buildNovelAiReferencePayload("nai5", {
            vibe: [{encodingBase64: "vibe", strength: 0.6, informationExtracted: 0.3}],
            character: [],
        })).toThrow("当前 V5 模型不支持所选参数：Vibe Transfer");
        expect(buildNovelAiReferencePayload("nai5", {vibe: [], character: []})).toEqual({});
    });

    it("验证参考数组长度并报告字段", () => {
        expect(() => validateNovelAiPayload("nai45", {
            width: 832,
            height: 1216,
            scale: 5,
            sampler: "k_euler",
            steps: 28,
            seed: 1,
            reference_image_multiple_cached: [{data: "vibe"}],
            reference_strength_multiple: [],
        })).toThrow(/reference_strength_multiple/u);
    });
});
