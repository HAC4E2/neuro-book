import {describe, expect, it} from "vitest";
import {parseChatu8CharacterVisualSource} from "nbook/server/text-to-image/chatu8-character-visual-source";

const encoder = new TextEncoder();

/** 构造公开明文角色/服装 export fixture。 */
function source(images: object = {}) {
    return {
        characters: {
            hero: {
                nameCN: "主角",
                nameEN: "hero",
                characterTraits: "calm, athletic",
                facialFeatures: "short brown hair",
                facialFeaturesBack: "short hair from behind",
                upperBodySFW: "white shirt",
                upperBodySFWBack: "white shirt from behind",
                fullBodySFW: "navy shorts",
                fullBodySFWBack: "navy shorts from behind",
                upperBodyNSFW: "",
                upperBodyNSFWBack: "",
                fullBodyNSFW: "",
                fullBodyNSFWBack: "",
                outfits: ["travel"],
                photoImageIds: ["image-1"],
                selectedPhotoIndex: 0,
                photoPrompt: "ignored generation prompt",
                sendPhoto: false,
                generationContext: "ignored",
                generationWorldBook: "ignored",
                generationVariables: {mood: "calm"},
            },
        },
        outfits: {
            travel: {
                nameCN: "旅行装",
                nameEN: "travel outfit",
                owner: "hero",
                upperBody: "coat",
                upperBodyBack: "coat from behind",
                fullBody: "trousers",
                fullBodyBack: "trousers from behind",
                photoImageIds: [],
                selectedPhotoIndex: 0,
                photoPrompt: "ignored",
                sendPhoto: false,
            },
        },
        images,
    };
}

describe("Chatu8 public character visual source", () => {
    it("只投影公开明文字段，并生成稳定 character/outfit identity", () => {
        const parsed = parseChatu8CharacterVisualSource(encoder.encode(JSON.stringify(source())));

        expect(parsed.state).toBe("proposal_ready");
        expect(parsed.characters).toHaveLength(1);
        expect(parsed.characters[0]).toMatchObject({
            sourceKey: "hero",
            names: {cn: "主角", en: "hero"},
            fields: {
                profileTraits: "calm, athletic",
                facialAppearance: "short brown hair",
                lowerSfw: "navy shorts",
                negativePrompt: "",
            },
            outfits: [{
                sourceKey: "travel",
                ownerSourceCharacterId: expect.stringMatching(/^chatu8-character-[a-f0-9]{24}$/u),
                fields: {upper: "coat", lower: "trousers"},
            }],
        });
        expect(parsed.characters[0]!.sourceCharacterId).toMatch(/^chatu8-character-[a-f0-9]{24}$/u);
        expect(parsed.characters[0]!.outfits[0]!.sourceOutfitId).toMatch(/^chatu8-outfit-[a-f0-9]{24}$/u);
        expect(JSON.stringify(parsed)).not.toContain("ignored generation prompt");
        expect(JSON.stringify(parsed)).not.toContain("generationVariables");
    });

    it("object key 顺序与 images bytes 不影响 visualSourceHash，但原始文件 hash 会变化", () => {
        const first = parseChatu8CharacterVisualSource(encoder.encode(JSON.stringify(source({one: "data:image/png;base64,AAAA"}))));
        const reordered = parseChatu8CharacterVisualSource(encoder.encode(JSON.stringify({
            images: {two: "data:image/png;base64,BBBB"},
            outfits: source().outfits,
            characters: source().characters,
        })));

        expect(reordered.visualSourceHash).toBe(first.visualSourceHash);
        expect(reordered.characters).toEqual(first.characters);
        expect(reordered.rawSourceHash).not.toBe(first.rawSourceHash);
    });

    it("加密、tagData 与未知 root shape 全部 report-only，不解密或猜 schema", () => {
        const encrypted = parseChatu8CharacterVisualSource(encoder.encode(JSON.stringify({
            ...source(),
            _encrypted: true,
            _nameMap: "base64",
            _version: "1.0",
        })));
        expect(encrypted.state).toBe("report_only");
        expect(encrypted.characters).toEqual([]);
        expect(encrypted.diagnostics.map((item) => item.code)).toContain("ENCRYPTED_EXPORT_UNSUPPORTED");

        const tagData = parseChatu8CharacterVisualSource(encoder.encode(JSON.stringify({...source(), tagData: {}})));
        expect(tagData.state).toBe("report_only");
        expect(tagData.diagnostics.map((item) => item.code)).toContain("TAGDATA_FORBIDDEN");

        const unknown = parseChatu8CharacterVisualSource(encoder.encode(JSON.stringify({...source(), privateRuntime: {}})));
        expect(unknown.state).toBe("report_only");
        expect(unknown.diagnostics.map((item) => item.code)).toContain("UNKNOWN_ROOT_FIELD");
    });

    it("未知 record 字段只隔离该记录；缺失、共享或 owner 冲突的 outfit 不产生角色 proposal", () => {
        const unknownRecord = source();
        unknownRecord.characters.hero = {...unknownRecord.characters.hero, privateMacro: "{{wire}}"} as typeof unknownRecord.characters.hero;
        const unknownParsed = parseChatu8CharacterVisualSource(encoder.encode(JSON.stringify(unknownRecord)));
        expect(unknownParsed.characters).toEqual([]);
        expect(unknownParsed.diagnostics.map((item) => item.code)).toContain("UNKNOWN_CHARACTER_FIELD");

        const missing = source();
        missing.outfits = {};
        const missingParsed = parseChatu8CharacterVisualSource(encoder.encode(JSON.stringify(missing)));
        expect(missingParsed.characters).toEqual([]);
        expect(missingParsed.diagnostics.map((item) => item.code)).toContain("OUTFIT_REF_MISSING");

        const ownerConflict = source();
        ownerConflict.outfits.travel.owner = "another-character";
        const ownerParsed = parseChatu8CharacterVisualSource(encoder.encode(JSON.stringify(ownerConflict)));
        expect(ownerParsed.characters).toEqual([]);
        expect(ownerParsed.diagnostics.map((item) => item.code)).toContain("OUTFIT_OWNER_CONFLICT");

        const shared = source();
        shared.characters.rival = {...shared.characters.hero, nameCN: "对手", nameEN: "rival"};
        const sharedParsed = parseChatu8CharacterVisualSource(encoder.encode(JSON.stringify(shared)));
        expect(sharedParsed.characters).toEqual([]);
        expect(sharedParsed.diagnostics.filter((item) => item.code === "OUTFIT_SHARED")).toHaveLength(2);
    });
});
