import {afterEach, describe, expect, it, vi} from "vitest";
import {resolveTextToImageRuntimePlaceholders} from "nbook/server/text-to-image/runtime-placeholder";

describe("resolveTextToImageRuntimePlaceholders", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("替换正文、上下文、用户需求与世界书占位符", () => {
        const result = resolveTextToImageRuntimePlaceholders(
            "正文：{{正文}}；上下文：{{上下文}}；需求：{{用户需求}}；世界书：{{世界书触发}}",
            {
                body: "第一段",
                context: "背景资料",
                userDemand: "画一张插图",
                worldBook: "触发条目",
            },
        );
        expect(result).toBe("正文：第一段；上下文：背景资料；需求：画一张插图；世界书：触发条目");
    });

    it("按顺序处理变量设置与读取", () => {
        const result = resolveTextToImageRuntimePlaceholders(
            "{@setvar::seed::42@}{@getvar::seed@}，{@setworldvar::world::W@}{@getworldvar::world@}，{{getvar::seed}}",
        );
        expect(result).toBe("42，W，42");
    });

    it("解析 1d6 骰子并落在 1..6 内", () => {
        vi.spyOn(Math, "random").mockReturnValue(0.5);
        const result = resolveTextToImageRuntimePlaceholders("点数：{{roll 1d6}}");
        expect(result).toMatch(/^点数：\d+$/u);
        const value = Number(result.slice(3));
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(6);
    });
});
