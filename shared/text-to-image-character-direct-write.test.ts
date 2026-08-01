import {describe, expect, it} from "vitest";
import {
    CHARACTER_VISUAL_DIRECT_WRITE_TERMINAL_ERROR_CODES,
    CHARACTER_VISUAL_OPERATION_RUNNING_CODE,
    CharacterVisualDirectorOutputSchema,
    CharacterVisualDirectWriteErrorCodeSchema,
    CharacterVisualDirectWriteRequestSchema,
    CharacterVisualDirectWriteTerminalErrorCodeSchema,
} from "nbook/shared/text-to-image-character-direct-write";

const HASH = `sha256:${"a".repeat(64)}`;
const REQUEST = {
    projectPath: "D:/novels/demo",
    characterPath: "lorebook/character/林雪/index.md",
    sourceCharacterFileHash: HASH,
    idempotencyKey: "9aa9105b-0c1c-4ad3-9032-20b2aafc7e5f",
};

function character() {
    return {
        names: {cn: "林雪", en: "Lin Xue"},
        fields: {
            profileTraits: "gentle,elegant",
            facialAppearance: "long black hair,blue eyes",
            facialBack: "long black hair,nape",
            upperSfw: "slender body,white shirt",
            upperBackSfw: "slender body,white shirt",
            lowerSfw: "long legs,black skirt",
            lowerBackSfw: "long legs,black skirt",
            upperNsfw: "",
            upperBackNsfw: "",
            lowerNsfw: "",
            lowerBackNsfw: "",
            negativePrompt: "bad anatomy",
        },
    };
}

function outfit() {
    return {
        names: {cn: "少女校服", en: "school uniform"},
        fields: {
            upper: "white shirt,blue ribbon",
            upperBack: "white shirt",
            lower: "black skirt",
            lowerBack: "black skirt",
        },
    };
}

function output() {
    return {
        schemaVersion: "nbook.character-visual-director-output/v2" as const,
        operation: "generate-character-visual" as const,
        state: "completed" as const,
        sourceCharacterFileHash: HASH,
        summary: "已生成角色视觉草稿。",
        character: character(),
        outfits: [outfit()],
        diagnostics: [],
    };
}

describe("character visual direct-write contract", () => {
    it("rejects invalid request identity boundaries", () => {
        expect(CharacterVisualDirectWriteRequestSchema.parse(REQUEST)).toEqual(REQUEST);
        expect(() => CharacterVisualDirectWriteRequestSchema.parse({...REQUEST, idempotencyKey: "not-a-uuid"})).toThrow();
        expect(() => CharacterVisualDirectWriteRequestSchema.parse({...REQUEST, characterPath: "lorebook/character/林雪/image-tags.md"})).toThrow();
        expect(() => CharacterVisualDirectWriteRequestSchema.parse({...REQUEST, sourceCharacterFileHash: "sha256:bad"})).toThrow();
    });

    it("requires completed drafts and excludes all drafts from blocked output", () => {
        expect(CharacterVisualDirectorOutputSchema.parse(output()).character).not.toBeNull();
        expect(() => CharacterVisualDirectorOutputSchema.parse({...output(), character: null})).toThrow();
        expect(() => CharacterVisualDirectorOutputSchema.parse({
            ...output(), state: "blocked", character: character(), outfits: [],
        })).toThrow();
        expect(() => CharacterVisualDirectorOutputSchema.parse({
            ...output(), state: "blocked", character: null, outfits: [outfit()],
        })).toThrow();
    });

    it("allows an outfit to omit Chinese name but still requires English and character names", () => {
        expect(CharacterVisualDirectorOutputSchema.parse({
            ...output(), outfits: [{...outfit(), names: {cn: "", en: "dark navy sailor uniform"}}],
        }).outfits[0]?.names).toEqual({cn: "", en: "dark navy sailor uniform"});
        expect(() => CharacterVisualDirectorOutputSchema.parse({
            ...output(), outfits: [{...outfit(), names: {cn: "", en: ""}}],
        })).toThrow();
        expect(() => CharacterVisualDirectorOutputSchema.parse({
            ...output(), character: {...character(), names: {cn: "", en: "Lin Xue"}},
        })).toThrow();
    });

    it("requires every outfit field and limits each raw field to 20 trimmed non-empty tags", () => {
        const {lowerBack: _lowerBack, ...missingField} = outfit().fields;
        expect(() => CharacterVisualDirectorOutputSchema.parse({
            ...output(), outfits: [{...outfit(), fields: missingField}],
        })).toThrow();
        expect(() => CharacterVisualDirectorOutputSchema.parse({
            ...output(), character: {...character(), fields: {...character().fields, profileTraits: "gentle, , elegant"}},
        })).toThrow();
        expect(() => CharacterVisualDirectorOutputSchema.parse({
            ...output(), character: {...character(), fields: {...character().fields, profileTraits: "gentle,  elegant"}},
        })).toThrow();
        expect(() => CharacterVisualDirectorOutputSchema.parse({
            ...output(), character: {...character(), fields: {...character().fields, profileTraits: "gentle  , elegant"}},
        })).toThrow();
        expect(() => CharacterVisualDirectorOutputSchema.parse({
            ...output(), character: {...character(), fields: {...character().fields, profileTraits: "gentle,\telegant"}},
        })).toThrow();
        expect(() => CharacterVisualDirectorOutputSchema.parse({
            ...output(), character: {...character(), fields: {...character().fields, profileTraits: Array.from({length: 21}, (_, index) => `tag-${index}`).join(",")}},
        })).toThrow();
    });

    it("freezes the terminal error subset and keeps running non-terminal", () => {
        for (const code of CHARACTER_VISUAL_DIRECT_WRITE_TERMINAL_ERROR_CODES) {
            expect(CharacterVisualDirectWriteTerminalErrorCodeSchema.parse(code)).toBe(code);
            expect(CharacterVisualDirectWriteErrorCodeSchema.parse(code)).toBe(code);
        }
        expect(CharacterVisualDirectWriteErrorCodeSchema.parse(CHARACTER_VISUAL_OPERATION_RUNNING_CODE)).toBe(CHARACTER_VISUAL_OPERATION_RUNNING_CODE);
        expect(() => CharacterVisualDirectWriteTerminalErrorCodeSchema.parse(CHARACTER_VISUAL_OPERATION_RUNNING_CODE)).toThrow();
        expect(() => CharacterVisualDirectWriteErrorCodeSchema.parse("PROJECT_NOT_OPEN")).toThrow();
    });
});
