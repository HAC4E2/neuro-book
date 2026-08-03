import {describe, expect, it} from "vitest";
import {
    applyReplacementProfile,
    parseReplacementRules,
} from "nbook/server/text-to-image/sensitive-word-replacement";

describe("sensitive word replacement", () => {
    it("按 find=replace 行规则全局替换", () => {
        const result = applyReplacementProfile({
            text: "今天岁数不小，小学生也来了。",
            rulesText: "岁=🎄\n小学=🏫",
            kind: "text",
        });
        expect(result).toBe("今天🎄数不小，🏫生也来了。");
    });

    it("支持 A|B=replace 多触发词", () => {
        const rules = parseReplacementRules("陈思宇|张雅=人物");
        expect(rules).toHaveLength(2);
        expect(applyReplacementProfile({
            text: "陈思宇和张雅",
            rulesText: "陈思宇|张雅=人物",
            kind: "text",
        })).toBe("人物和人物");
    });

    it("aiReplacement 只作用于 AI 回复", () => {
        const result = applyReplacementProfile({
            text: "sf_ is not safe_",
            rulesText: "sf_=safe_",
            kind: "ai",
        });
        expect(result).toBe("safe_ is not safe_");
    });
});
