import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    buildBodyCharacterSummary,
    CharacterTriggerAmbiguityError,
    scanBodyCharacters,
    scanBodyCharactersFromProject,
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
        triggerWords: "小克 | 克",
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
    it("触发词为空时回退到英文名和中文名", () => {
        const matches = scanBodyCharacters({
            chapterContent: "清晨，林推开教室门。",
            characters: [{characterId: "lin", visual: lin}],
        });
        expect(matches.map((match) => match.characterId)).toEqual(["lin"]);
        expect(matches[0]?.matchedTrigger).toBe("林");
    });

    it("显式触发词非空时只按显式列表扫描，不自动使用中英文名", () => {
        const onlyEnglish: CharacterVisualFile = {
            ...xiaoKe,
            character: {...xiaoKe.character, cnName: "小克", enName: "Xiao Ke", triggerWords: "kraken | sea"},
        };
        expect(scanBodyCharacters({
            chapterContent: "Xiao Ke walked in.",
            characters: [{characterId: "xiao-ke", visual: onlyEnglish}],
        })).toEqual([]);
        expect(scanBodyCharacters({
            chapterContent: "The kraken rises.",
            characters: [{characterId: "xiao-ke", visual: onlyEnglish}],
        }).map((match) => match.characterId)).toEqual(["xiao-ke"]);
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
        expect(matches[0]?.matchedTriggers).toEqual(["小克", "克"]);
        expect(matches[1]?.matchedTrigger).toBe("林");
        expect(matches.every((match) => match.source === "trigger")).toBe(true);
    });

    it("英文匹配不区分大小写并兼容 NFKC 全角字符", () => {
        const visual: CharacterVisualFile = {
            ...lin,
            characterId: "elysia",
            character: {...lin.character, cnName: "艾莉希雅", enName: "Elysia", triggerWords: "Elysia"},
        };
        expect(scanBodyCharacters({
            chapterContent: "elysia 出现",
            characters: [{characterId: "elysia", visual}],
        })).toHaveLength(1);
        expect(scanBodyCharacters({
            chapterContent: "ELYSIA 出现",
            characters: [{characterId: "elysia", visual}],
        })).toHaveLength(1);
        expect(scanBodyCharacters({
            chapterContent: "Ｅｌｙｓｉａ 出现",
            characters: [{characterId: "elysia", visual}],
        })).toHaveLength(1);
    });

    it("没有命中时返回空数组", () => {
        const matches = scanBodyCharacters({
            chapterContent: "教室里只有阳光。",
            characters: [{characterId: "xiao-ke", visual: xiaoKe}],
        });
        expect(matches).toEqual([]);
    });

    it("matchedTrigger 选择正文最早出现者，位置相同取更长触发词", () => {
        const visual: CharacterVisualFile = {
            ...lin,
            characterId: "hero",
            character: {...lin.character, cnName: "英雄", enName: "Hero", triggerWords: "克 | 小克 | 英雄"},
        };
        const matches = scanBodyCharacters({
            chapterContent: "英雄小克走过。",
            characters: [{characterId: "hero", visual}],
        });
        // “英雄”出现在索引 0，“小克”出现在索引 2，“克”出现在索引 3；最早命中者是“英雄”。
        expect(matches[0]?.matchedTrigger).toBe("英雄");
        expect(matches[0]?.matchedTriggers).toEqual(["克", "小克", "英雄"]);
    });

    it("同一角色多个触发词命中只注入一次", () => {
        const matches = scanBodyCharacters({
            chapterContent: "小克就是克。",
            characters: [{characterId: "xiao-ke", visual: xiaoKe}],
        });
        expect(matches).toHaveLength(1);
        expect(matches[0]?.matchedTriggers).toEqual(["小克", "克"]);
        expect(matches[0]?.matchedTrigger).toBe("小克");
    });

    it("不同角色被同一规范化触发词命中时返回歧义错误", () => {
        const alice: CharacterVisualFile = {
            ...lin,
            characterId: "alice",
            character: {...lin.character, cnName: "爱丽丝", enName: "Alice", triggerWords: "shared"},
        };
        const bob: CharacterVisualFile = {
            ...lin,
            characterId: "bob",
            character: {...lin.character, cnName: "鲍勃", enName: "Bob", triggerWords: "SHARED"},
        };
        expect(() => scanBodyCharacters({
            chapterContent: "shared appears",
            characters: [
                {characterId: "alice", visual: alice},
                {characterId: "bob", visual: bob},
            ],
        })).toThrow(CharacterTriggerAmbiguityError);
        try {
            scanBodyCharacters({
                chapterContent: "shared appears",
                characters: [
                    {characterId: "alice", visual: alice},
                    {characterId: "bob", visual: bob},
                ],
            });
        } catch (error) {
            expect(error).toBeInstanceOf(CharacterTriggerAmbiguityError);
            expect((error as CharacterTriggerAmbiguityError).trigger).toBe("shared");
            expect((error as CharacterTriggerAmbiguityError).characters.map((item) => item.displayName)).toEqual(["爱丽丝", "鲍勃"]);
        }
    });

    it("组装 chatu8 风格的<人物>与<服装列表>摘要", () => {
        const summary = buildBodyCharacterSummary([
            {characterId: "xiao-ke", groupId: null, visual: xiaoKe, matchedTrigger: "小克", matchedTriggers: ["小克"], source: "trigger"},
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

    it("scans every enabled group when groupId is omitted", async () => {
        const root = await createRoot();
        await createCharacterGroup(root, "fantasy");
        await writeCharacterVisual(root, "xiao-ke", xiaoKe, "fantasy");

        const matches = await scanBodyCharactersFromProject({
            projectRoot: root,
            chapterContent: "清晨，小克站在窗边。",
        });

        expect(matches.map((match) => match.characterId)).toEqual(["xiao-ke"]);
    });

    it("uses the highest-priority enabled group when the same id appears in multiple groups", async () => {
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
        ]);
    });

    it("跨角色同触发词在 Project 扫描中同样返回歧义错误", async () => {
        const root = await createRoot();
        await createCharacterGroup(root, "default");
        await writeCharacterVisual(root, "alice", {
            ...lin,
            characterId: "alice",
            character: {...lin.character, cnName: "爱丽丝", triggerWords: "shared"},
        }, "default");
        await writeCharacterVisual(root, "bob", {
            ...lin,
            characterId: "bob",
            character: {...lin.character, cnName: "鲍勃", triggerWords: "shared"},
        }, "default");

        await expect(scanBodyCharactersFromProject({
            projectRoot: root,
            chapterContent: "shared appears",
        })).rejects.toBeInstanceOf(CharacterTriggerAmbiguityError);
    });

    async function createRoot(): Promise<string> {
        const directory = await mkdtemp(path.join(tmpdir(), "nbook-body-character-scanner-"));
        temporaryDirectories.push(directory);
        return directory;
    }
});
