import {describe, expect, it, vi} from "vitest";
import {createTextToImageFileHash} from "nbook/shared/text-to-image-file-hash";
import {
    generateCharacterVisualFiles,
    type CharacterVisualDirectWriteRuntime,
} from "nbook/server/text-to-image/character-image-tags";

const source = "# Hero\n";
const sourceHash = createTextToImageFileHash(source);

function runtime(): CharacterVisualDirectWriteRuntime {
    let started = false;
    const files = new Map<string, string>([["lorebook/character/hero/index.md", source]]);
    return {
        read: async (path) => files.get(path) ?? null,
        write: async ({path, content, knownBefore}) => {
            expect(files.get(path) ?? null).toBe(knownBefore);
            files.set(path, content);
        },
        snapshot: async () => ({
            root: "/project/demo",
            characterId: "hero",
            characterPath: "lorebook/character/hero/index.md",
            sourceMarkdown: source,
            characterImageTags: null,
            referencedOutfits: [],
        }),
        acquire: async () => ({sessionId: 1}),
        resolve: async () => started
            ? {state: "completed" as const, invocationId: "invoke-1", reportResult: {
                schemaVersion: "nbook.character-visual-director-output/v2",
                operation: "generate-character-visual",
                state: "completed",
                sourceCharacterFileHash: sourceHash,
                summary: "完成",
                character: {names: {cn: "英雄", en: "Hero"}, fields: {profileTraits: "calm", facialAppearance: "brown eyes", facialBack: "short hair", upperSfw: "coat", upperBackSfw: "coat", lowerSfw: "boots", lowerBackSfw: "boots", upperNsfw: "", upperBackNsfw: "", lowerNsfw: "", lowerBackNsfw: "", negativePrompt: ""}},
                outfits: [],
                diagnostics: [],
            }}
            : {state: "missing" as const},
        start: async ({onAccepted}) => {
            await onAccepted({sessionId: 1, invocationId: "invoke-1", clientMessageId: "fixed"});
            started = true;
        },
        materialize: async () => ({characterMarkdown: "character target\n", outfits: [], diagnostics: []}),
        sleep: async () => undefined,
        now: () => 0,
        invalidate: vi.fn(),
    };
}

describe("character image-tags direct orchestration", () => {
    it("accepts only the direct request and returns the completed-only result", async () => {
        const result = await generateCharacterVisualFiles({
            projectPath: "workspace/demo",
            characterPath: "lorebook/character/hero/index.md",
            sourceCharacterFileHash: sourceHash,
            idempotencyKey: "9aa9105b-0c1c-4ad3-9032-20b2aafc7e5f",
        }, runtime());
        expect(result).toMatchObject({state: "completed", sessionId: 1, invocationId: "invoke-1"});
    });

    it("rejects malformed direct request before runtime execution", async () => {
        await expect(generateCharacterVisualFiles({
            projectPath: "workspace/demo",
            characterPath: "lorebook/character/hero/image-tags.md",
            sourceCharacterFileHash: sourceHash,
            idempotencyKey: "not-a-uuid",
        }, runtime())).rejects.toThrow();
    });
});
