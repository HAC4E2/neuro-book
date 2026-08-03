import {describe, expect, it} from "vitest";
import {applyPromptReplaceRules} from "nbook/server/text-to-image/prompt-replacement";

describe("applyPromptReplaceRules", () => {
    it("替换命中触发词", () => {
        const result = applyPromptReplaceRules(
            "1girl, white dress, forest",
            "white dress=替换|red dress",
        );
        expect(result).toBe("1girl, red dress, forest");
    });

    it("支持多触发词与前置/后置插入", () => {
        const result = applyPromptReplaceRules(
            "1girl, forest",
            [
                "forest|夜晚=前置前|night",
                "forest=后置后|moonlight",
                "forest=最后置|stars",
            ].join("\n"),
        );
        expect(result).toBe("night, 1girl, forest, moonlight, stars");
    });

    it("@if 条件控制规则是否生效", () => {
        const rules = "forest=替换|night forest @if(\"night\")";
        expect(applyPromptReplaceRules("forest, night", rules)).toContain("night forest");
        expect(applyPromptReplaceRules("forest, day", rules)).toBe("forest, day");
    });

    it("空规则原样返回", () => {
        expect(applyPromptReplaceRules("1girl", "  \n  ")).toBe("1girl");
    });
});
