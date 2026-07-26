import {describe, expect, it} from "vitest";
import {parseTtpStoryboardJson} from "nbook/server/text-to-image/ttp-storyboard-json";
import {
    TTP_STORYBOARD_CHUNK_LIMITS,
    inspectTtpStoryboard,
} from "nbook/server/text-to-image/ttp-storyboard-inspector";

function parse(value: object) {
    return parseTtpStoryboardJson(new TextEncoder().encode(JSON.stringify(value)));
}

describe("deterministic TTP Storyboard inspector", () => {
    it("保留 allowlist/provenance/disabled/trigger，并确定性路由七类候选与风险 flags", () => {
        const inspected = inspectTtpStoryboard(parse({
            "示例预设": {
                entries: {
                    core: {
                        id: "director-core",
                        role: "system",
                        enabled: true,
                        triggerMode: "always",
                        triggerWords: [],
                        andTriggerWords: [],
                        content: "为章节选择有视觉价值的单一瞬间，控制分镜、镜头和构图分布。",
                        extensions: {ignored: true},
                    },
                    rainy: {
                        role: "user",
                        enabled: true,
                        triggerMode: "trigger",
                        triggerWords: ["雨夜"],
                        andTriggerWords: ["小巷"],
                        content: "rainy alley, wide shot, backlighting, standing, wet pavement",
                    },
                    style: {
                        role: "system",
                        enabled: true,
                        triggerMode: "always",
                        triggerWords: [],
                        andTriggerWords: [],
                        content: "masterpiece, best quality, cinematic anime style",
                    },
                    macro: {
                        role: "system",
                        enabled: true,
                        triggerMode: "always",
                        triggerWords: [],
                        andTriggerWords: [],
                        content: "{{roll 1d4}} 个镜头",
                    },
                    disabledExample: {
                        role: "assistant",
                        enabled: false,
                        triggerMode: "always",
                        triggerWords: [],
                        andTriggerWords: [],
                        content: "输出模板：<image>final prompt</image>",
                    },
                },
            },
        }));

        expect(inspected.entries).toHaveLength(5);
        expect(inspected.entries[0]!.sourceIdentity.identityKind).toBe("explicit_id");
        expect(inspected.entries[0]!.unknownFields).toEqual(["extensions"]);
        expect(inspected.entries[0]!.classifications).toContain("core_rule");
        expect(inspected.entries[1]!.sourceIdentity.identityKind).toBe("map_key");
        expect(inspected.entries[1]!.triggerWords).toEqual(["雨夜"]);
        expect(inspected.entries[1]!.classifications).toEqual(expect.arrayContaining(["scene_recipe", "trigger_alias"]));
        expect(inspected.entries[2]!.classifications).toContain("style_quality");
        expect(inspected.entries[3]!.classifications).toContain("macro");
        expect(inspected.macroTokens).toEqual([
            expect.objectContaining({token: "{{roll 1d4}}", classification: "stochastic", blocking: true}),
        ]);
        expect(inspected.entries[4]!.enabled).toBe(false);
        expect(inspected.entries[4]!.flags.outputTemplate).toBe(true);
        const chunkEntryIds = new Set(inspected.chunks.flatMap((chunk) => chunk.segments.map((segment) => segment.sourceEntryId)));
        expect(chunkEntryIds.has(inspected.entries[3]!.sourceIdentity.sourceEntryId)).toBe(false);
        expect(chunkEntryIds.has(inspected.entries[4]!.sourceIdentity.sourceEntryId)).toBe(false);
    });

    it("fallback canonical identity 对 key 顺序稳定，但内容变化会产生新 identity", () => {
        const first = inspectTtpStoryboard(parse({entries: [{role: "system", content: "镜头规则", enabled: true}]}));
        const reordered = inspectTtpStoryboard(parse({entries: [{enabled: true, content: "镜头规则", role: "system"}]}));
        const changed = inspectTtpStoryboard(parse({entries: [{role: "system", content: "另一条镜头规则", enabled: true}]}));

        expect(first.entries[0]!.sourceIdentity.identityKind).toBe("canonical_hash");
        expect(first.entries[0]!.sourceIdentity.sourceEntryId).toBe(reordered.entries[0]!.sourceIdentity.sourceEntryId);
        expect(first.entries[0]!.sourceIdentity.sourceEntryId).not.toBe(changed.entries[0]!.sourceIdentity.sourceEntryId);
    });

    it("宏区分白名单、身份、Tag fragment、随机与未知歧义", () => {
        const inspected = inspectTtpStoryboard(parse({entries: [{
            content: "{{正文}} {{user}} {{rain, night}} {{random::a::b}} {{mystery}}",
            role: "system",
            enabled: true,
        }]}));

        expect(inspected.macroTokens.map((token) => [token.classification, token.blocking])).toEqual([
            ["registered_binding", false],
            ["identity", false],
            ["tag_fragment", false],
            ["stochastic", true],
            ["unknown", true],
        ]);
    });

    it("chunk manifest 每块最多 64 entries / 80k 字符，且长 entry 分片不截断", () => {
        const manyEntries = Array.from({length: TTP_STORYBOARD_CHUNK_LIMITS.maxEntriesPerChunk + 1}, (_value, index) => ({
            id: `entry-${String(index)}`,
            role: "system",
            enabled: true,
            content: `镜头规则 ${String(index)}`,
        }));
        const many = inspectTtpStoryboard(parse({entries: manyEntries}));
        const exposedIds = new Set(many.chunks.flatMap((chunk) => chunk.segments.map((segment) => segment.sourceEntryId)));
        expect(many.chunks).toHaveLength(2);
        expect(many.chunks.every((chunk) => chunk.entryCount <= TTP_STORYBOARD_CHUNK_LIMITS.maxEntriesPerChunk)).toBe(true);
        expect(exposedIds.size).toBe(manyEntries.length);

        const longContent = "镜头".repeat((TTP_STORYBOARD_CHUNK_LIMITS.maxCharactersPerChunk + 10000) / 2);
        const long = inspectTtpStoryboard(parse({entries: [{id: "long", role: "system", enabled: true, content: longContent}]}));
        const segments = long.chunks.flatMap((chunk) => chunk.segments);
        expect(long.chunks.every((chunk) => chunk.characterCount <= TTP_STORYBOARD_CHUNK_LIMITS.maxCharactersPerChunk)).toBe(true);
        expect(segments.map((segment) => [segment.startOffset, segment.endOffset])).toEqual([
            [0, TTP_STORYBOARD_CHUNK_LIMITS.maxCharactersPerChunk],
            [TTP_STORYBOARD_CHUNK_LIMITS.maxCharactersPerChunk, longContent.length],
        ]);
        expect(segments.reduce((total, segment) => total + segment.endOffset - segment.startOffset, 0)).toBe(longContent.length);
    });

    it("相同输入的 entries/macros/chunks 与 hash 完全稳定", () => {
        const source = parse({entries: [{id: "one", role: "system", enabled: true, content: "wide shot, night, rain"}]});
        expect(inspectTtpStoryboard(source)).toEqual(inspectTtpStoryboard(source));
    });
});
