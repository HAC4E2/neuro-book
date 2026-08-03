import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {compileBodyPrompt} from "nbook/server/text-to-image/body-prompt-compiler";
import {renderCharacterVisualJson, type CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";

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
            outfits: [],
            photos: [],
        });

        const code = `${"$"}{${JSON.stringify({name: "爱丽丝", upperBody: "sfw", lowerBody: "sfw"})}}$`;
        const result = await compileBodyPrompt(workspaceRoot, `${code}，standing`);

        expect(result.prompt).toContain("Alice");
        expect(result.prompt).toContain("white dress");
        expect(result.prompt).toContain("standing");
        expect(result.negativePrompt).toBe("blurry");
    });

    it("不存在的角色抛错", async () => {
        const code = `${"$"}{${JSON.stringify({name: "Bob"})}}$`;
        await expect(compileBodyPrompt(workspaceRoot, code)).rejects.toThrow(/未找到角色.*Bob/);
    });
});

async function writeVisual(characterId: string, visual: CharacterVisualFile): Promise<void> {
    const directory = path.join(workspaceRoot, "lorebook", "character", characterId);
    await mkdir(directory, {recursive: true});
    await writeFile(path.join(directory, "visual.json"), renderCharacterVisualJson(visual), "utf8");
}
