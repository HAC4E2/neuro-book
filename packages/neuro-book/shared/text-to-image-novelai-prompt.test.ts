import {describe, expect, it} from "vitest";
import {dedupeNovelAiPrompt} from "nbook/shared/text-to-image-novelai-prompt";

describe("dedupeNovelAiPrompt", () => {
    it("移除重复 tag 并保留加权版本", () => {
        expect(dedupeNovelAiPrompt("1girl, blue eyes, 1girl:1.2, blue eyes")).toBe("1girl:1.2, blue eyes");
    });

    it("规范空白和多余逗号，但不改变 tag 顺序", () => {
        expect(dedupeNovelAiPrompt(" , 1girl , , school uniform, 1girl , ")).toBe("1girl, school uniform");
    });

    it("把 NovelAI 权重写法的基础 tag 作为同一个重复键", () => {
        expect(dedupeNovelAiPrompt("{{long hair}}, long hair:1.1, 1.2::long hair::")).toBe("1.2::long hair::");
    });

    it("按不区分大小写的基础 tag 去重并识别方括号", () => {
        expect(dedupeNovelAiPrompt("Blue Eyes, [blue eyes], BLUE EYES:1.1")).toBe("BLUE EYES:1.1");
    });
});
