import {describe, expect, it} from "vitest";
import {estimateNovelAiTokens, normalizeNovelAiTokenText} from "nbook/app/utils/novelai-token-counter";

describe("novelai token counter", () => {
    it("按 chatu-8 预处理规则清理权重、换行和括号", () => {
        expect(normalizeNovelAiTokenText("1girl::1.2, 1.2::long hair::\n{{blue eyes}} [school]")).toBe("1girl, long hair blue eyes school");
    });

    it("空 prompt 为 0，不触发模型加载", async () => {
        await expect(estimateNovelAiTokens("")).resolves.toBe(0);
    });
});
