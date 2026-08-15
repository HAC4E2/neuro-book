import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {compileBodyPrompt} from "nbook/server/text-to-image/body-prompt-compiler";
import {renderCharacterVisualJson, type CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";
import {
    createCharacterGroup,
    writeCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";

let workspaceRoot: string;

beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "nbook-body-prompt-compiler-"));
});

afterEach(async () => {
    await rm(workspaceRoot, {recursive: true, force: true});
});

describe("compileBodyPrompt", () => {
    it("compiles an inline temporary character without creating a project visual file", async () => {
        const inlineCharacter = {
            cnName: "临时人物",
            enName: "Temp Hero",
            profileTraits: "silver hair, amber eyes",
            facialAppearance: "sharp eyes",
            upperSfw: "black coat",
            lowerSfw: "boots",
        };
        const code = `${"$"}{${JSON.stringify({
            name: "Temp Hero",
            character: inlineCharacter,
            upperBody: "sfw",
            lowerBody: "sfw",
        })}}$`;

        const result = await compileBodyPrompt(workspaceRoot, `${code}, standing`);

        expect(result.prompt).toContain("Temp Hero");
        expect(result.prompt).toContain("silver hair, amber eyes");
        expect(result.prompt).toContain("black coat");
    });

    it("compiles an independent outfit without requiring a character name", async () => {
        const code = `${"$"}{${JSON.stringify({
            outfit: {
                cnName: "旅行装",
                enName: "Travel Outfit",
                upper: "white shirt",
                upperBack: "shirt back",
                lower: "cargo pants",
                lowerBack: "pants back",
            },
            angle: "from back",
            upperBody: "sfw",
            lowerBody: "hidden",
        })}}$`;

        const result = await compileBodyPrompt(workspaceRoot, code);

        expect(result.prompt).toContain("shirt back");
        expect(result.prompt).not.toContain("cargo pants");
    });

    it("展开角色调用代码并收集负面提示词", async () => {
        await writeVisual("alice", {
            schema: "nbook.character-visual/v1",
            characterId: "alice",
            character: {
                cnName: "爱丽丝",
                enName: "Alice",
                profileTraits: "gentle, kind",
                facialAppearance: "blue eyes, long blonde hair",
                facialBack: "long hair from behind",
                upperSfw: "white dress",
                upperBackSfw: "dress back",
                lowerSfw: "white skirt",
                lowerBackSfw: "skirt back",
                upperNsfw: "",
                upperBackNsfw: "",
                lowerNsfw: "",
                lowerBackNsfw: "",
                negativePrompt: "blurry",
            },
            outfits: [{
                cnName: "校服",
                enName: "School Uniform",
                upper: "white shirt, navy vest",
                upperBack: "plain vest back",
                lower: "navy pleated skirt",
                lowerBack: "plain skirt back",
            }],
            photos: [],
        });

        const code = `${"$"}{${JSON.stringify({name: "爱丽丝", upperBody: "sfw", lowerBody: "sfw"})}}$`;
        const result = await compileBodyPrompt(workspaceRoot, `${code}，standing`);

        expect(result.prompt).toContain("Alice");
        expect(result.prompt).toContain("white dress");
        expect(result.prompt).toContain("standing");
        expect(result.negativePrompt).toBe("blurry");
    });

    it("展开角色调用中的 outfit 并按视角与上下半身选择服装 tag", async () => {
        await writeVisual("alice", {
            schema: "nbook.character-visual/v1",
            characterId: "alice",
            character: {
                cnName: "爱丽丝",
                enName: "Alice",
                profileTraits: "gentle, kind",
                facialAppearance: "blue eyes, long blonde hair",
                facialBack: "long hair from behind",
                upperSfw: "white dress",
                upperBackSfw: "dress back",
                lowerSfw: "white skirt",
                lowerBackSfw: "skirt back",
                upperNsfw: "",
                upperBackNsfw: "",
                lowerNsfw: "",
                lowerBackNsfw: "",
                negativePrompt: "blurry",
            },
            outfits: [{
                cnName: "校服",
                enName: "School Uniform",
                upper: "white shirt, navy vest",
                upperBack: "plain vest back",
                lower: "navy pleated skirt",
                lowerBack: "plain skirt back",
            }],
            photos: [],
        });
        const code = `${"$"}{${JSON.stringify({
            name: "Alice",
            outfit: "School Uniform",
            angle: "back",
            upperBody: "sfw",
            lowerBody: "hidden",
        })}}$`;

        const result = await compileBodyPrompt(workspaceRoot, code);

        expect(result.prompt).toContain("long hair from behind");
        expect(result.prompt).toContain("dress back");
        expect(result.prompt).toContain("plain vest back");
        expect(result.prompt).not.toContain("plain skirt back");
    });

    it("不存在的角色抛错", async () => {
        const code = `${"$"}{${JSON.stringify({name: "Bob"})}}$`;
        await expect(compileBodyPrompt(workspaceRoot, code)).rejects.toThrow(/未找到角色.*Bob/);
    });

    it("兼容 LLM 漏掉外层大括号的角色调用 JSON", async () => {
        await writeVisual("lin-yanzhou", {
            schema: "nbook.character-visual/v1",
            characterId: "lin-yanzhou",
            character: {
                cnName: "林砚舟",
                enName: "Lin Yanzhou",
                triggerWords: "砚舟, 阿舟",
                profileTraits: "calm, intelligent",
                facialAppearance: "black hair, brown eyes",
                upperSfw: "white shirt",
                lowerSfw: "black trousers",
            },
            outfits: [],
            photos: [],
        });

        const rawWithoutBraces = '"name":"林砚舟","angle":"from front","upperBody":"sfw","lowerBody":"sfw"';
        const result = await compileBodyPrompt(workspaceRoot, `${"$"}{${rawWithoutBraces}}$`);

        expect(result.prompt).toContain("Lin Yanzhou");
        expect(result.prompt).toContain("white shirt");
    });

    it("使用触发名和中文名命中同一个角色", async () => {
        await writeVisual("lin-yanzhou", {
            schema: "nbook.character-visual/v1",
            characterId: "lin-yanzhou",
            character: {
                cnName: "林砚舟",
                enName: "Lin Yanzhou",
                triggerWords: "砚舟, 阿舟",
                profileTraits: "calm",
                facialAppearance: "black hair",
                upperSfw: "white shirt",
                lowerSfw: "black trousers",
            },
            outfits: [],
            photos: [],
        });

        for (const name of ["林砚舟", "砚舟", "阿舟", "Lin Yanzhou"]) {
            const code = `${"$"}{${JSON.stringify({name, upperBody: "sfw", lowerBody: "sfw"})}}$`;
            await expect(compileBodyPrompt(workspaceRoot, code)).resolves.toMatchObject({
                prompt: expect.stringContaining("Lin Yanzhou"),
            });
        }
    });

    it("拒绝截断 JSON 和存在但非法的调用字段", async () => {
        await expect(compileBodyPrompt(workspaceRoot, `${"$"}{"name":"林砚舟"$`)).rejects.toThrow(/不是合法 JSON/);
        await expect(compileBodyPrompt(workspaceRoot, `${"$"}{${JSON.stringify({name: "林砚舟", angle: "side"})}}$`)).rejects.toThrow(/angle/);
    });

    it("resolves character codes inside grouped paths", async () => {
        await createCharacterGroup(workspaceRoot, "fantasy");
        await writeCharacterVisual(workspaceRoot, "bob", {
            schema: "nbook.character-visual/v1",
            characterId: "bob",
            character: {
                cnName: "Bob",
                enName: "Bob",
                profileTraits: "brave",
                facialAppearance: "short black hair",
                upperSfw: "leather jacket",
                lowerSfw: "jeans",
            },
            outfits: [],
            photos: [],
        }, "fantasy");

        const code = `${"$"}{${JSON.stringify({name: "Bob", upperBody: "sfw", lowerBody: "sfw"})}}$`;
        const result = await compileBodyPrompt(workspaceRoot, code);

        expect(result.prompt).toContain("Bob");
        expect(result.prompt).toContain("leather jacket");
    });

    it("resolves an explicit groupId when character ids overlap", async () => {
        await createCharacterGroup(workspaceRoot, "fantasy");
        await createCharacterGroup(workspaceRoot, "modern");
        await writeCharacterVisual(workspaceRoot, "bob", {
            schema: "nbook.character-visual/v1",
            characterId: "bob",
            character: {
                cnName: "Fantasy Bob",
                enName: "Fantasy Bob",
                profileTraits: "fantasy",
                facialAppearance: "fantasy hair",
                upperSfw: "fantasy coat",
                lowerSfw: "fantasy pants",
            },
            outfits: [],
            photos: [],
        }, "fantasy");
        await writeCharacterVisual(workspaceRoot, "bob", {
            schema: "nbook.character-visual/v1",
            characterId: "bob",
            character: {
                cnName: "Modern Bob",
                enName: "Modern Bob",
                profileTraits: "modern",
                facialAppearance: "modern hair",
                upperSfw: "modern jacket",
                lowerSfw: "modern jeans",
            },
            outfits: [],
            photos: [],
        }, "modern");

        const code = `${"$"}{${JSON.stringify({
            name: "Bob",
            characterId: "bob",
            groupId: "modern",
            upperBody: "sfw",
            lowerBody: "sfw",
        })}}$`;
        const result = await compileBodyPrompt(workspaceRoot, code);

        expect(result.prompt).toContain("Modern Bob");
        expect(result.prompt).toContain("modern jacket");
        expect(result.prompt).not.toContain("Fantasy Bob");
        expect(result.prompt).not.toContain("fantasy coat");
    });

    it("uses the priority visual when an id is present in multiple enabled groups", async () => {
        await createCharacterGroup(workspaceRoot, "fantasy");
        await createCharacterGroup(workspaceRoot, "modern");
        for (const groupId of ["fantasy", "modern"]) {
            await writeCharacterVisual(workspaceRoot, "bob", {
                schema: "nbook.character-visual/v1",
                characterId: "bob",
                character: {cnName: "Bob", enName: "Bob", triggerWords: "shared"},
                outfits: [],
                photos: [],
            }, groupId);
        }

        const code = `${"$"}{${JSON.stringify({name: "shared", upperBody: "sfw", lowerBody: "sfw"})}}$`;
        await expect(compileBodyPrompt(workspaceRoot, code)).resolves.toMatchObject({prompt: "Bob"});
    });

    it("rejects an ambiguous alias shared by different logical characters", async () => {
        await createCharacterGroup(workspaceRoot, "fantasy");
        await createCharacterGroup(workspaceRoot, "modern");
        await writeCharacterVisual(workspaceRoot, "alice", {
            schema: "nbook.character-visual/v1",
            characterId: "alice",
            character: {cnName: "Alice", triggerWords: "shared", upperSfw: "dress"},
            outfits: [],
            photos: [],
        }, "fantasy");
        await writeCharacterVisual(workspaceRoot, "bob", {
            schema: "nbook.character-visual/v1",
            characterId: "bob",
            character: {cnName: "Bob", triggerWords: "shared", upperSfw: "coat"},
            outfits: [],
            photos: [],
        }, "modern");
        const code = `${"$"}{${JSON.stringify({name: "shared", upperBody: "sfw", lowerBody: "sfw"})}}$`;
        await expect(compileBodyPrompt(workspaceRoot, code)).rejects.toThrow(/多个候选/);
    });

    it("expands the chatu-8 legacy upper-body invocation syntax", async () => {
        await writeVisual("alice", {
            schema: "nbook.character-visual/v1",
            characterId: "alice",
            character: {
                cnName: "Alice",
                enName: "Alice",
                profileTraits: "gentle",
                facialAppearance: "blue eyes",
                upperSfw: "white blouse",
                lowerSfw: "pleated skirt",
            },
            outfits: [],
            photos: [],
        });

        const result = await compileBodyPrompt(
            workspaceRoot,
            "$Alice-sfw-upperbody$,$Alice-sfw-upperbody-sfw-lowerbody$",
        );

        expect(result.prompt).toContain("white blouse");
        expect(result.prompt).not.toMatch(/pleated skirt,\s*Alice/);
        expect(result.prompt).toContain("pleated skirt");
    });

    it("expands the chatu-8 legacy syntax with an explicit back view", async () => {
        await writeVisual("alice", {
            schema: "nbook.character-visual/v1",
            characterId: "alice",
            character: {
                cnName: "Alice",
                enName: "Alice",
                profileTraits: "gentle",
                facialAppearance: "blue eyes",
                facialBack: "long blonde hair from behind",
                upperBackSfw: "blouse back",
                lowerBackSfw: "skirt back",
            },
            outfits: [],
            photos: [],
        });

        const result = await compileBodyPrompt(
            workspaceRoot,
            "$Alice-back-sfw-upperbody-sfw-lowerbody$",
        );

        expect(result.prompt).toContain("long blonde hair from behind");
        expect(result.prompt).toContain("blouse back");
        expect(result.prompt).toContain("skirt back");
        expect(result.prompt).not.toContain("blue eyes");
    });
    it("treats from behind as a back DNA call", async () => {
        await writeVisual("alice", {
            schema: "nbook.character-visual/v1",
            characterId: "alice",
            character: {
                cnName: "Alice",
                enName: "Alice",
                facialAppearance: "blue eyes",
                facialBack: "long hair from behind",
                upperBackSfw: "back blouse",
            },
            outfits: [],
            photos: [],
        });

        const code = `${"$"}{${JSON.stringify({name: "Alice", angle: "from behind", upperBody: "sfw", lowerBody: "hidden"})}}$`;
        await expect(compileBodyPrompt(workspaceRoot, code)).resolves.toMatchObject({
            prompt: expect.stringContaining("long hair from behind"),
        });
    });

    it("accepts chatu-8 Chinese inline DNA field labels", async () => {
        const code = `${"$"}{${JSON.stringify({
            name: "临时角色",
            character: {
                中文名称: "临时角色",
                英文名称: "Temporary Hero",
                角色特征: "silver hair, amber eyes",
                五官外貌: "sharp eyes",
                上半身SFW: "black coat",
                下半身SFW: "boots",
            },
            upperBody: "sfw",
            lowerBody: "sfw",
        })}}$`;

        const result = await compileBodyPrompt(workspaceRoot, code);

        expect(result.prompt).toContain("Temporary Hero");
        expect(result.prompt).toContain("silver hair, amber eyes");
        expect(result.prompt).toContain("black coat");
        expect(result.prompt).toContain("boots");
    });

    it("accepts Chinese inline outfit field labels", async () => {
        const code = `${"$"}{${JSON.stringify({
            outfit: {
                中文名称: "旅行装",
                英文名称: "Travel Outfit",
                上半身: "white shirt",
                下半身: "cargo pants",
            },
            upperBody: "sfw",
            lowerBody: "sfw",
        })}}$`;

        const result = await compileBodyPrompt(workspaceRoot, code);

        expect(result.prompt).toContain("white shirt");
        expect(result.prompt).toContain("cargo pants");
    });

    it("reuses a batch-scoped temporary character without reading project storage", async () => {
        const temporaryCharacter = {
            schema: "nbook.character-visual/v1" as const,
            characterId: "temporary:hero",
            character: {
                cnName: "临时英雄",
                enName: "Temporary Hero",
                triggerWords: "临时英雄, Temporary Hero",
                profileTraits: "silver hair",
                facialAppearance: "amber eyes",
                upperSfw: "black coat",
                lowerSfw: "boots",
            },
            outfits: [],
            photos: [],
        };
        const code = `${"$"}{${JSON.stringify({name: "Temporary Hero", upperBody: "sfw", lowerBody: "sfw"})}}$`;
        const result = await compileBodyPrompt(workspaceRoot, code, {
            temporaryCharacters: [temporaryCharacter],
        });

        expect(result.prompt).toContain("silver hair");
        expect(result.prompt).toContain("black coat");
    });
});

async function writeVisual(characterId: string, visual: CharacterVisualFile): Promise<void> {
    const directory = path.join(workspaceRoot, "lorebook", "character", characterId);
    await mkdir(directory, {recursive: true});
    await writeFile(path.join(directory, "visual.json"), renderCharacterVisualJson(visual), "utf8");
}
