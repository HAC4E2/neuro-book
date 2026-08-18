import {describe, expect, it} from "vitest";
import {
    buildCharacterReferenceTerms,
    buildEffectiveCharacterTriggers,
    canonicalizeTriggerWords,
    containsForbiddenTriggerSeparator,
    normalizeTriggerToken,
    parsePipeCharacterTriggers,
    TriggerWordFormatError,
} from "nbook/server/text-to-image/character-trigger-words";
import type {CharacterVisualField} from "nbook/server/text-to-image/character-visual.codec";

function makeCharacter(fields: Partial<CharacterVisualField> = {}): CharacterVisualField {
    return {
        cnName: "",
        enName: "",
        triggerWords: "",
        profileTraits: "",
        facialAppearance: "",
        facialBack: "",
        upperSfw: "",
        upperBackSfw: "",
        lowerSfw: "",
        lowerBackSfw: "",
        upperNsfw: "",
        upperBackNsfw: "",
        lowerNsfw: "",
        lowerBackNsfw: "",
        negativePrompt: "",
        ...fields,
    };
}

describe("character trigger words 领域模块", () => {
    it("按半角竖线解析并规范化为单空格包围的 | 格式", () => {
        expect(parsePipeCharacterTriggers("艾莉希雅 | 爱莉 | Elysia")).toEqual({
            values: ["艾莉希雅", "爱莉", "Elysia"],
            canonical: "艾莉希雅 | 爱莉 | Elysia",
        });
        expect(canonicalizeTriggerWords(" 艾莉希雅|爱莉 | Elysia ")).toBe("艾莉希雅 | 爱莉 | Elysia");
    });

    it("去除每项首尾空白，按 NFKC 规范化去重且保留第一次输入的文本形式", () => {
        const parsed = parsePipeCharacterTriggers("Elysia | ｅｌｙｓｉａ | ELYSIA");
        expect(parsed.values).toEqual(["Elysia"]);
        expect(parsed.canonical).toBe("Elysia");
    });

    it("空字符串解析为空列表", () => {
        expect(parsePipeCharacterTriggers("")).toEqual({values: [], canonical: ""});
        expect(canonicalizeTriggerWords("   ")).toBe("");
    });

    it("拒绝英文逗号和中文逗号", () => {
        expect(containsForbiddenTriggerSeparator("艾莉希雅, 爱莉")).toBe(true);
        expect(containsForbiddenTriggerSeparator("艾莉希雅，爱莉")).toBe(true);
        expect(containsForbiddenTriggerSeparator("艾莉希雅 | 爱莉")).toBe(false);
        expect(() => parsePipeCharacterTriggers("艾莉希雅, 爱莉")).toThrow(TriggerWordFormatError);
        expect(() => parsePipeCharacterTriggers("艾莉希雅，爱莉")).toThrow(/只能使用 \| 分隔/u);
    });

    it("拒绝连续空项与首尾空项", () => {
        expect(() => parsePipeCharacterTriggers("艾莉希雅 || 爱莉")).toThrow(/连续空项/u);
        expect(() => parsePipeCharacterTriggers("| 艾莉希雅")).toThrow(/空项/u);
        expect(() => parsePipeCharacterTriggers("艾莉希雅 | ")).toThrow(/空项/u);
    });

    it("normalizeTriggerToken 使用 NFKC 与大小写折叠", () => {
        expect(normalizeTriggerToken("Ｅｌｙｓｉａ")).toBe(normalizeTriggerToken("elysia"));
        expect(normalizeTriggerToken("ELYsia")).toBe(normalizeTriggerToken("elysia"));
    });

    it("显式触发词为空时只回退非空中英文名", () => {
        expect(buildEffectiveCharacterTriggers(makeCharacter({cnName: "艾莉希雅", enName: "Elysia"})))
            .toEqual(["Elysia", "艾莉希雅"]);
        expect(buildEffectiveCharacterTriggers(makeCharacter({cnName: "  ", enName: " ", triggerWords: "  "})))
            .toEqual([]);
    });

    it("显式触发词非空时不自动追加中英文名", () => {
        expect(buildEffectiveCharacterTriggers(makeCharacter({
            cnName: "艾莉希雅",
            enName: "Elysia",
            triggerWords: "爱莉 | 小艾",
        }))).toEqual(["爱莉", "小艾"]);
    });

    it("显式引用查找词包含触发词与中英文名（供 ${角色:名} 展开使用）", () => {
        expect(buildCharacterReferenceTerms(makeCharacter({
            cnName: "艾莉希雅",
            enName: "Elysia",
            triggerWords: "爱莉 | 小艾",
        }))).toEqual(["爱莉", "小艾", "Elysia", "艾莉希雅"]);
    });
});
