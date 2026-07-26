import {describe, expect, it} from "vitest";
import {
    createStoryboardPresetFileHash,
    parseStoryboardPresetMarkdown,
    renderStoryboardPresetMarkdown,
} from "nbook/server/text-to-image/storyboard-preset.codec";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function preset() {
    return {
        schema: "nbook.storyboard-preset/v1" as const,
        presetId: "cinematic-chapter",
        patternSetId: "cinematic-chapter",
        packageId: "ttppkg_01JDEMO",
        resourceKey: "cinematic-chapter--demo",
        title: "章节电影化分镜",
        enabled: true,
        source: {
            kind: "ttp" as const,
            importId: "ttps_01JDEMO",
            rawSourceHash: HASH_A,
            sanitizedSourceHash: HASH_B,
            converterVersion: "1",
        },
        review: {status: "pending" as const},
        matching: {normalization: "nfkc-casefold" as const},
        defaults: {preferredShotCount: {min: 5, max: 7}, minimumParagraphGap: 2},
        macros: {bindings: {正文: "chapter.markdown" as const}, unresolved: []},
        rules: [],
        risks: [],
    };
}

describe("Storyboard Preset Markdown codec", () => {
    it("规范渲染与严格解析稳定 round-trip", () => {
        const first = renderStoryboardPresetMarkdown(preset(), "# 分镜说明\n\n仅供人类阅读。\n");
        const parsed = parseStoryboardPresetMarkdown(first);
        const second = renderStoryboardPresetMarkdown(parsed.preset, parsed.body);
        expect(second).toBe(first);
        expect(parsed.preset).toEqual(preset());
        expect(parsed.fileHash).toBe(createStoryboardPresetFileHash(first));
    });

    it("拒绝重复 key、anchor、alias、merge、自定义 tag 与未知字段", () => {
        const markdown = renderStoryboardPresetMarkdown(preset());
        const duplicate = markdown.replace("enabled: true", "enabled: true\nenabled: false");
        const anchor = markdown.replace("title: 章节电影化分镜", "title: &title 章节电影化分镜");
        const alias = markdown.replace("title: 章节电影化分镜", "title: &title 章节电影化分镜").replace("resourceKey: cinematic-chapter--demo", "resourceKey: *title");
        const merge = markdown.replace("matching:", "mergeProbe: &probe { enabled: true }\n<<: *probe\nmatching:");
        const customTag = markdown.replace("title: 章节电影化分镜", "title: !custom 章节电影化分镜");
        const forgedStandardTag = markdown.replace(
            "title: 章节电影化分镜",
            "title: !<tag:yaml.org,2002:evil> 章节电影化分镜",
        );
        const unknown = markdown.replace("enabled: true", "enabled: true\nmodel: nai-diffusion");

        for (const invalid of [duplicate, anchor, alias, merge, customTag, forgedStandardTag, unknown]) {
            expect(() => parseStoryboardPresetMarkdown(invalid)).toThrow();
        }
    });

    it("正文只改变 fileHash，不改变 strict contract hash", () => {
        const first = renderStoryboardPresetMarkdown(preset(), "# 说明 A\n");
        const second = renderStoryboardPresetMarkdown(preset(), "# 说明 B\n");
        const parsedFirst = parseStoryboardPresetMarkdown(first);
        const parsedSecond = parseStoryboardPresetMarkdown(second);
        expect(parsedFirst.hashes).toEqual(parsedSecond.hashes);
        expect(parsedFirst.fileHash).not.toBe(parsedSecond.fileHash);
    });
});
