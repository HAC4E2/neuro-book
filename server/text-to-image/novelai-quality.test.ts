import {describe, expect, it} from "vitest";
import {resolveNovelAiQualityPresets} from "nbook/server/text-to-image/novelai-quality";

describe("resolveNovelAiQualityPresets", () => {
    it("nai-diffusion-4-5-full 使用对应 AQT/UCP", () => {
        const result = resolveNovelAiQualityPresets({
            model: "nai-diffusion-4-5-full",
            positiveEnabled: true,
            negativePreset: "Heavy",
        });
        expect(result.aqt).toContain("masterpiece");
        expect(result.ucp).toContain("blank page");
    });

    it("关闭正面质量预设时 AQT 为空", () => {
        const result = resolveNovelAiQualityPresets({
            model: "nai-diffusion-4-5-full",
            positiveEnabled: false,
            negativePreset: "none",
        });
        expect(result.aqt).toBe("");
        expect(result.ucp).toBe("");
    });

    it("V5 Full/Curated 不臆造 V4.5 AQT，但保留已确认的 V5 UCP", () => {
        for (const model of ["nai-diffusion-5-full", "nai-diffusion-5-curated"]) {
            const result = resolveNovelAiQualityPresets({model, positiveEnabled: true, negativePreset: "Light"});
            expect(result.aqt).toBe("");
            expect(result.ucp).toContain("0::ai-generated::");
        }
    });
});
