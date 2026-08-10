import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    buildBodyCharacterSummary,
    buildCharacterTriggerWords,
    scanBodyCharactersFromProject,
    scanBodyCharacters,
    splitCharacterTriggerWords,
} from "nbook/server/text-to-image/body-character-scanner";
import type {CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";
import {
    createCharacterGroup,
    writeCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";

const xiaoKe: CharacterVisualFile = {
    schema: "nbook.character-visual/v1",
    characterId: "xiao-ke",
    character: {
        cnName: "小克",
        enName: "Xiao Ke",
        triggerWords: "小克, 克",
        profileTraits: "innocent, gentle",
        facialAppearance: "long black hair, blue eyes",
        facialBack: "black hair back",
        upperSfw: "school uniform",
        upperBackSfw: "shoulders",
        lowerSfw: "navy skirt",
        lowerBackSfw: "legs",
        upperNsfw: "",
        upperBackNsfw: "",
        lowerNsfw: "",
        lowerBackNsfw: "",
        negativePrompt: "bad anatomy",
    },
    outfits: [{
        cnName: "校服",
        enName: "School Uniform",
        upper: "white shirt",
        upperBack: "plain back",
        lower: "navy skirt",
        lowerBack: "plain back",
    }],
    photos: [],
};

const lin: CharacterVisualFile = {
    schema: "nbook.character-visual/v1",
    characterId: "lin",
    character: {
        cnName: "林",
        enName: "Lin",
        triggerWords: "",
        profileTraits: "calm",
        facialAppearance: "short brown hair",
        facialBack: "",
        upperSfw: "coat",
        upperBackSfw: "",
        lowerSfw: "trousers",
        lowerBackSfw: "",
        upperNsfw: "",
        upperBackNsfw: "",
        lowerNsfw: "",
        lowerBackNsfw: "",
        negativePrompt: "",
    },
    outfits: [],
    photos: [],
};

describe("body character scanner", () => {
    it("拆分并去重逗号分隔的触发词", () => {
        expect(splitCharacterTriggerWords(" 小克, 克 ,小克, ,克 ")).toEqual(["小克", "克"]);
    });

    it("触发词为空时回退到中文名和英文名", () => {
        expect(buildCharacterTriggerWords(lin.character)).toEqual(["Lin", "林"]);
    });

    it("按子串扫描正文并只返回命中角色", () => {
        const matches = scanBodyCharacters({
            chapterContent: "清晨，林推开教室门，看见小克站在窗边。",
            characters: [
                {characterId: "xiao-ke", visual: xiaoKe},
                {characterId: "lin", visual: lin},
            ],
        });

        expect(matches.map((match) => match.characterId)).toEqual(["xiao-ke", "lin"]);
        expect(matches[0]?.matchedTrigger).toBe("小克");
        expect(matches[1]?.matchedTrigger).toBe("林");
    });

    it("没有命中时返回空数组", () => {
        const matches = scanBodyCharacters({
            chapterContent: "教室里只有阳光。",
            characters: [{characterId: "xiao-ke", visual: xiaoKe}],
        });
        expect(matches).toEqual([]);
    });

    it("组装 chatu8 风格的<人物>与<服装列表>摘要", () => {
        const summary = buildBodyCharacterSummary([
            {characterId: "xiao-ke", visual: xiaoKe, matchedTrigger: "小克"},
        ]);

        expect(summary).toContain("<人物>");
        expect(summary).toContain("中文名：小克");
        expect(summary).toContain("英文名：Xiao Ke");
        expect(summary).toContain("角色特征：innocent, gentle");
        expect(summary).toContain("五官正面：long black hair, blue eyes");
        expect(summary).toContain("上半身 SFW 正面：school uniform");
        expect(summary).toContain("下半身 NSFW 背面：");
        expect(summary).toContain("<服装列表>");
        expect(summary).toContain("<服装>");
        expect(summary).toContain("服装名：校服");
        expect(summary).toContain("上半身正面：white shirt");
        expect(summary).toContain("</人物>");
        expect(summary).toContain("</服装>");
    });

    it("无命中角色时返回空摘要", () => {
        expect(buildBodyCharacterSummary([])).toBe("");
    });
});

describe("scanBodyCharactersFromProject", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
    });

    it("scans characters inside the selected group", async () => {
        const root = await createRoot();
        await createCharacterGroup(root, "default");
        await writeCharacterVisual(root, "lin", lin, "default");

        const matches = await scanBodyCharactersFromProject({
            projectRoot: root,
            chapterContent: "林走进教室。",
            groupId: "default",
        });

        expect(matches.map((match) => match.characterId)).toEqual(["lin"]);
    });

    it("scans every group when groupId is omitted", async () => {
        const root = await createRoot();
        await createCharacterGroup(root, "fantasy");
        await writeCharacterVisual(root, "xiao-ke", xiaoKe, "fantasy");

        const matches = await scanBodyCharactersFromProject({
            projectRoot: root,
            chapterContent: "清晨，小克站在窗边。",
        });

        expect(matches.map((match) => match.characterId)).toEqual(["xiao-ke"]);
    });

    it("keeps matching characters with the same id in different groups", async () => {
        const root = await createRoot();
        await createCharacterGroup(root, "fantasy");
        await createCharacterGroup(root, "modern");
        await writeCharacterVisual(root, "hero", {
            ...lin,
            characterId: "hero",
            character: {...lin.character, cnName: "Fantasy Hero", enName: "Fantasy Hero", triggerWords: "hero"},
        }, "fantasy");
        await writeCharacterVisual(root, "hero", {
            ...lin,
            characterId: "hero",
            character: {...lin.character, cnName: "Modern Hero", enName: "Modern Hero", triggerWords: "hero"},
        }, "modern");

        const matches = await scanBodyCharactersFromProject({
            projectRoot: root,
            chapterContent: "hero appears in the chapter",
        });

        expect(matches).toEqual([
            expect.objectContaining({characterId: "hero", groupId: "fantasy"}),
            expect.objectContaining({characterId: "hero", groupId: "modern"}),
        ]);
    });

    async function createRoot(): Promise<string> {
        const directory = await mkdtemp(path.join(tmpdir(), "nbook-body-character-scanner-"));
        temporaryDirectories.push(directory);
        return directory;
    }
});
