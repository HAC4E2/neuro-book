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
});

async function writeVisual(characterId: string, visual: CharacterVisualFile): Promise<void> {
    const directory = path.join(workspaceRoot, "lorebook", "character", characterId);
    await mkdir(directory, {recursive: true});
    await writeFile(path.join(directory, "visual.json"), renderCharacterVisualJson(visual), "utf8");
}
