import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
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
});

async function createRoot(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "nbook-character-visual-"));
    temporaryDirectories.push(directory);
    return directory;
}
