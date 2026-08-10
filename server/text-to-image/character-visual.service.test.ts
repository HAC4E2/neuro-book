import {access, mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    createCharacterGroup,
    deleteCharacterGroup,
    deleteCharacterVisual,
    listCharacterGroups,
    listCharacterVisualIds,
    readCharacterVisual,
    writeCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";
import type {CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

describe("character visual service", () => {
    it("write 后 read 可以往返还原", async () => {
        const root = await createRoot();
        const input: CharacterVisualFile = {
            schema: "nbook.character-visual/v1",
            characterId: "char-1",
            character: {cnName: "小克", facialAppearance: "long black hair"},
            outfits: [],
            photos: [],
        };

        await writeCharacterVisual(root, "char-1", input);
        const read = await readCharacterVisual(root, "char-1");

        expect(read).toMatchObject({
            characterId: "char-1",
            character: {cnName: "小克", facialAppearance: "long black hair"},
        });
    });

    it("文件不存在返回 null", async () => {
        const root = await createRoot();
        await expect(readCharacterVisual(root, "missing")).resolves.toBeNull();
    });

    it("supports grouped read, write and list", async () => {
        const root = await createRoot();
        await createCharacterGroup(root, "fantasy", {name: "Fantasy"});
        const input: CharacterVisualFile = {
            schema: "nbook.character-visual/v1",
            characterId: "alice",
            character: {cnName: "Alice", enName: "Alice"},
            outfits: [],
            photos: [],
        };

        await writeCharacterVisual(root, "alice", input, "fantasy");

        await expect(readCharacterVisual(root, "alice", "fantasy")).resolves.toMatchObject({
            characterId: "alice",
            character: {cnName: "Alice"},
        });
        await expect(readCharacterVisual(root, "alice")).resolves.toMatchObject({
            characterId: "alice",
            character: {cnName: "Alice"},
        });
        await expect(listCharacterVisualIds(root, "fantasy")).resolves.toEqual(["alice"]);
        await expect(listCharacterGroups(root)).resolves.toEqual([{
            groupId: "fantasy",
            name: "Fantasy",
            description: "",
        }]);
    });

    it("default group falls back to legacy single-level path", async () => {
        const root = await createRoot();
        const input: CharacterVisualFile = {
            schema: "nbook.character-visual/v1",
            characterId: "hero",
            character: {cnName: "Hero"},
            outfits: [],
            photos: [],
        };

        await writeCharacterVisual(root, "hero", input);

        await expect(readCharacterVisual(root, "hero", "default")).resolves.toMatchObject({
            characterId: "hero",
            character: {cnName: "Hero"},
        });
        await expect(listCharacterVisualIds(root, "default")).resolves.toEqual(["hero"]);
    });

    it("delete 分组内角色后列表和读取都为空", async () => {
        const root = await createRoot();
        await createCharacterGroup(root, "fantasy");
        const input: CharacterVisualFile = {
            schema: "nbook.character-visual/v1",
            characterId: "alice",
            character: {cnName: "Alice"},
            outfits: [],
            photos: [],
        };
        await writeCharacterVisual(root, "alice", input, "fantasy");
        await writeFile(path.join(root, "lorebook", "character", "fantasy", "alice", "index.md"), "# Alice\n", "utf8");

        await deleteCharacterVisual(root, "alice", "fantasy");

        await expect(readCharacterVisual(root, "alice", "fantasy")).resolves.toBeNull();
        await expect(listCharacterVisualIds(root, "fantasy")).resolves.toEqual([]);
        await expect(listCharacterGroups(root)).resolves.toEqual([{groupId: "fantasy", name: "fantasy", description: ""}]);
        await expect(writeFile(path.join(root, "lorebook", "character", "fantasy", "alice", "index.md"), "", {flag: "a"})).resolves.toBeUndefined();
    });

    it("delete default 角色兼容旧单层路径", async () => {
        const root = await createRoot();
        const input: CharacterVisualFile = {
            schema: "nbook.character-visual/v1",
            characterId: "hero",
            character: {cnName: "Hero"},
            outfits: [],
            photos: [],
        };
        await writeCharacterVisual(root, "hero", input);

        await deleteCharacterVisual(root, "hero", "default");

        await expect(readCharacterVisual(root, "hero", "default")).resolves.toBeNull();
    });

    it("删除视觉资料时只删除 visual.json 登记的 Project 照片", async () => {
        const root = await createRoot();
        const photoPath = path.join(root, "assets", "tti", "hero.png");
        await mkdir(path.dirname(photoPath), {recursive: true});
        await writeFile(photoPath, Buffer.from("image"));
        await writeCharacterVisual(root, "hero", {
            schema: "nbook.character-visual/v1",
            characterId: "hero",
            character: {cnName: "Hero"},
            outfits: [],
            photos: ["assets/tti/hero.png"],
        });

        await deleteCharacterVisual(root, "hero");

        await expect(access(photoPath)).rejects.toThrow();
        await expect(readCharacterVisual(root, "hero")).resolves.toBeNull();
    });

    it("delete 分组后分组列表不再包含该组", async () => {
        const root = await createRoot();
        await createCharacterGroup(root, "fantasy", {name: "Fantasy"});

        await deleteCharacterGroup(root, "fantasy");

        await expect(listCharacterGroups(root)).resolves.toEqual([]);
    });
});

async function createRoot(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "nbook-character-visual-"));
    temporaryDirectories.push(directory);
    return directory;
}
