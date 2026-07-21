import {describe, expect, it} from "vitest";
import {
    createTagPatternFileHash,
    parseTagPatternMarkdown,
    renderTagPatternMarkdown,
} from "nbook/server/text-to-image/tag-pattern.codec";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function patternSet() {
    return {
        schema: "nbook.tag-pattern-set/v1" as const,
        patternSetId: "cinematic-chapter",
        presetId: "cinematic-chapter",
        packageId: "c8pkg_01JDEMO",
        resourceKey: "cinematic-chapter--demo",
        title: "章节电影化场景组合",
        enabled: true,
        source: {
            kind: "chatu8" as const,
            importId: "c8s_01JDEMO",
            rawSourceHash: HASH_A,
            sanitizedSourceHash: HASH_B,
            converterVersion: "1",
        },
        review: {status: "pending" as const},
        patterns: [],
        risks: [],
    };
}

describe("Tag Pattern Markdown codec", () => {
    it("空 companion 也能规范 round-trip", () => {
        const first = renderTagPatternMarkdown(patternSet(), "# Pattern 说明\n");
        const parsed = parseTagPatternMarkdown(first);
        expect(renderTagPatternMarkdown(parsed.patternSet, parsed.body)).toBe(first);
        expect(parsed.patternSet.patterns).toEqual([]);
        expect(parsed.fileHash).toBe(createTagPatternFileHash(first));
    });

    it("拒绝 YAML 执行特性、schema 漂移与未知字段", () => {
        const markdown = renderTagPatternMarkdown(patternSet());
        const duplicate = markdown.replace("enabled: true", "enabled: true\nenabled: false");
        const anchor = markdown.replace("title: 章节电影化场景组合", "title: &title 章节电影化场景组合");
        const alias = markdown.replace("title: 章节电影化场景组合", "title: &title 章节电影化场景组合").replace("resourceKey: cinematic-chapter--demo", "resourceKey: *title");
        const customTag = markdown.replace("title: 章节电影化场景组合", "title: !custom 章节电影化场景组合");
        const wrongSchema = markdown.replace("nbook.tag-pattern-set/v1", "nbook.tag-pattern-set/v2");
        const unknown = markdown.replace("enabled: true", "enabled: true\nstyle: forbidden");

        for (const invalid of [duplicate, anchor, alias, customTag, wrongSchema, unknown]) {
            expect(() => parseTagPatternMarkdown(invalid)).toThrow();
        }
    });

    it("正文只改变 fileHash，不改变 planning/render hash", () => {
        const first = parseTagPatternMarkdown(renderTagPatternMarkdown(patternSet(), "# A\n"));
        const second = parseTagPatternMarkdown(renderTagPatternMarkdown(patternSet(), "# B\n"));
        expect(first.hashes).toEqual(second.hashes);
        expect(first.fileHash).not.toBe(second.fileHash);
    });
});
