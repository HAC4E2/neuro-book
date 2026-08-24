import {describe, expect, it} from "vitest";
import {
    applyPromptReplaceRules,
    applyPromptReplacementToSegments,
    parsePromptReplacementRules,
    validatePromptReplacementRules,
} from "nbook/server/text-to-image/prompt-replacement";

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

    it("七个动作与 替换| 空值删除均有确定位置", () => {
        const rules = [
            "x=前置前|before-front",
            "x=前置后|after-front",
            "x=替换|",
            "x=替换分角色|role-kept",
            "x=后置前|before-back",
            "x=后置后|after-back",
            "x=最后置|last",
        ].join("\n");
        const result = applyPromptReplacementToSegments({
            prompt: "x, 1girl",
            rulesText: rules,
            characterPrompts: [{prompt: "x, blue eyes", negativePrompt: ""}],
        });

        expect(result.basePositive).toBe("1girl");
        expect(result.characterPrompts[0]?.positive).toBe("role-kept, blue eyes");
        expect(applyPromptReplaceRules("x, 1girl", rules)).toBe(
            "before-front, after-front, 1girl, before-back, after-back, last",
        );
    });

    it("未知动作、缺 =、缺分隔符、空触发词均返回带行号错误", () => {
        const issues = validatePromptReplacementRules([
            "bad=未知动作|x",
            "no equal x",
            "x=替换",
            "=替换|x",
        ].join("\n"));
        expect(issues).toEqual([
            {lineNumber: 1, message: expect.stringContaining("第 1 行动作未知")},
            {lineNumber: 2, message: expect.stringContaining("第 2 行缺少 =")},
            {lineNumber: 3, message: expect.stringContaining("第 3 行缺少动作分隔符")},
            {lineNumber: 4, message: expect.stringContaining("第 4 行触发词为空")},
        ]);
        expect(parsePromptReplacementRules("x=替换|y").errors).toEqual([]);
    });

    it("触发与替换都基于 NFKC 且不区分大小写", () => {
        expect(applyPromptReplaceRules("ＦＯＲＥＳＴ, night", "forest=替换|woods")).toBe("ＦＯＲＥＳＴ, night".replace("ＦＯＲＥＳＴ", "woods"));
    });
});
