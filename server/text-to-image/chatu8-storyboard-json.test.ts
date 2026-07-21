import {describe, expect, it} from "vitest";
import {
    CHATU8_STORYBOARD_JSON_LIMITS,
    parseChatu8StoryboardJson,
} from "nbook/server/text-to-image/chatu8-storyboard-json";

function bytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

describe("strict Chatu8 Storyboard JSON reader", () => {
    it("支持 direct entries 与单 dynamic wrapper，并产生稳定 sanitized bytes", () => {
        const direct = parseChatu8StoryboardJson(bytes(JSON.stringify({name: "direct-demo", entries: [{id: "one", content: "规则"}]})));
        const wrapped = parseChatu8StoryboardJson(bytes(JSON.stringify({
            "动态预设名": {entries: [{id: "one", content: "规则"}]},
        })));
        const mapped = parseChatu8StoryboardJson(bytes(JSON.stringify({
            "映射预设": {entries: {beta: {content: "规则 B"}, alpha: {content: "规则 A"}}},
        })));

        expect(direct.sourceShape).toBe("direct_entries");
        expect(direct.sourcePresetKey).toBe("direct-demo");
        expect(direct.entries).toHaveLength(1);
        expect(wrapped.sourceShape).toBe("wrapped_entries");
        expect(wrapped.sourcePresetKey).toBe("动态预设名");
        expect(new TextDecoder().decode(wrapped.sanitizedBytes)).toBe('{"动态预设名":{"entries":[{"content":"规则","id":"one"}]}}');
        expect(mapped.entries.map((entry) => [entry.mapKey, entry.sourceOrder, entry.jsonPointer])).toEqual([
            ["beta", 0, "/映射预设/entries/beta"],
            ["alpha", 1, "/映射预设/entries/alpha"],
        ]);
        expect(wrapped.rawSourceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(wrapped.sanitizedSourceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    });

    it("token-aware 拒绝 duplicate key、prototype pollution key 与 unsafe number", () => {
        expect(() => parseChatu8StoryboardJson(bytes('{"entries":[],"entries":[]}'))).toThrow(/STORYBOARD_IMPORT_JSON_DUPLICATE_KEY/u);
        for (const unsafeKey of ["__proto__", "prototype", "constructor"]) {
            expect(() => parseChatu8StoryboardJson(bytes(`{"entries":[],"nested":{"${unsafeKey}":true}}`))).toThrow(
                /STORYBOARD_IMPORT_JSON_UNSAFE_KEY/u,
            );
        }
        expect(() => parseChatu8StoryboardJson(bytes('{"entries":[],"value":9007199254740992}'))).toThrow(
            /STORYBOARD_IMPORT_JSON_UNSAFE_NUMBER/u,
        );
    });

    it("在任何持久化 bytes 形成前递归删除 secret，并只报告 JSON Pointer", () => {
        const first = parseChatu8StoryboardJson(bytes(JSON.stringify({
            entries: [{id: "one", content: "规则", apiKey: "secret-a", nested: {authorization: "Bearer a"}}],
        })));
        const second = parseChatu8StoryboardJson(bytes(JSON.stringify({
            entries: [{id: "one", content: "规则", apiKey: "secret-b", nested: {authorization: "Bearer b"}}],
        })));
        const sanitized = new TextDecoder().decode(first.sanitizedBytes);

        expect(first.secretPaths).toEqual(["/entries/0/apiKey", "/entries/0/nested/authorization"]);
        expect(sanitized).not.toContain("secret-a");
        expect(sanitized).not.toContain("Bearer a");
        expect(first.rawSourceHash).not.toBe(second.rawSourceHash);
        expect(first.sanitizedSourceHash).toBe(second.sanitizedSourceHash);
    });

    it("canonical sanitized hash 不受对象 key 物理顺序影响，且不修改输入 bytes", () => {
        const firstBytes = bytes('{"entries":[],"title":"demo"}');
        const before = [...firstBytes];
        const first = parseChatu8StoryboardJson(firstBytes);
        const second = parseChatu8StoryboardJson(bytes('{"title":"demo","entries":[]}'));

        expect([...firstBytes]).toEqual(before);
        expect(first.rawSourceHash).not.toBe(second.rawSourceHash);
        expect(first.sanitizedSourceHash).toBe(second.sanitizedSourceHash);
    });

    it("拒绝非法 UTF-8、深度/字符串/entry/文件越限", () => {
        expect(() => parseChatu8StoryboardJson(new Uint8Array([0xc3, 0x28]))).toThrow(/STORYBOARD_IMPORT_UTF8_INVALID/u);

        const depth = CHATU8_STORYBOARD_JSON_LIMITS.maxDepth + 1;
        expect(() => parseChatu8StoryboardJson(bytes(`${'{"nested":'.repeat(depth)}null${"}".repeat(depth)}`))).toThrow(
            /STORYBOARD_IMPORT_JSON_DEPTH_EXCEEDED/u,
        );
        expect(() => parseChatu8StoryboardJson(bytes(JSON.stringify({
            entries: [],
            value: "x".repeat(CHATU8_STORYBOARD_JSON_LIMITS.maxStringLength + 1),
        })))).toThrow(/STORYBOARD_IMPORT_JSON_STRING_TOO_LONG/u);
        expect(() => parseChatu8StoryboardJson(bytes(JSON.stringify({
            entries: Array.from({length: CHATU8_STORYBOARD_JSON_LIMITS.maxEntries + 1}, () => ({})),
        })))).toThrow(/STORYBOARD_IMPORT_ENTRY_LIMIT_EXCEEDED/u);
        expect(() => parseChatu8StoryboardJson(new Uint8Array(CHATU8_STORYBOARD_JSON_LIMITS.maxBytes + 1))).toThrow(
            /STORYBOARD_IMPORT_FILE_TOO_LARGE/u,
        );
    });

    it("拒绝多 wrapper、非 object wrapper 与缺失 entries 的 unsupported shape", () => {
        for (const invalid of [
            {first: {entries: []}, second: {entries: []}},
            {preset: []},
            {preset: {messages: []}},
            [],
        ]) {
            expect(() => parseChatu8StoryboardJson(bytes(JSON.stringify(invalid)))).toThrow(/STORYBOARD_IMPORT_SHAPE_UNSUPPORTED/u);
        }
    });
});
