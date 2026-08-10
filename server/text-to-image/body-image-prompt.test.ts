import {describe, expect, it} from "vitest";
import {
    buildBodyImageSystemPrompt,
    buildBodyImageUserPrompt,
} from "nbook/server/text-to-image/body-image-prompt";

describe("body image prompt", () => {
    it("system prompt 定义五要素 XML 输出契约", () => {
        const prompt = buildBodyImageSystemPrompt();

        expect(prompt).toContain("<content>");
        expect(prompt).toContain("<images>");
        expect(prompt).toContain("<image>");
        expect(prompt).toContain("<regex>");
        expect(prompt).toContain("<title_styled>");
        expect(prompt).toContain("<Tag_think>");
        expect(prompt).toContain("<size>");
        expect(prompt).toContain("<prompts>");
    });

    it("system prompt 要求 regex 是正文逐字挂载点且 prompts 是最终 NovelAI tag 串", () => {
        const prompt = buildBodyImageSystemPrompt();

        expect(prompt).toMatch(/挂载点/);
        expect(prompt).toMatch(/一字不差/);
        expect(prompt).toMatch(/NovelAI/);
        expect(prompt).toMatch(/英文逗号/);
    });

    it("user prompt 包含正文与角色摘要", () => {
        const prompt = buildBodyImageUserPrompt({
            chapterContent: "第一章正文。",
            characterSummary: "小克：long black hair, blue eyes",
        });

        expect(prompt).toContain("第一章正文。");
        expect(prompt).toContain("小克：long black hair, blue eyes");
    });

    it("user prompt 在角色摘要为空时标记无摘要", () => {
        const prompt = buildBodyImageUserPrompt({
            chapterContent: "正文",
            characterSummary: "",
        });

        expect(prompt).toContain("（无）");
    });

    it("system prompt 明确无角色段落不输出角色调用代码", () => {
        expect(buildBodyImageSystemPrompt()).toContain("只生成场景、镜头、环境 tag，不输出");
    });
});
