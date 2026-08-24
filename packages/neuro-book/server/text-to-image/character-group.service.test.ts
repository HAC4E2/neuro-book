import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    createCharacterGroup,
    listCharacterGroups,
    readCharacterVisual,
    updateCharacterGroup,
    writeCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});

describe("character group metadata", () => {
    it("updates display metadata without moving grouped character files", async () => {
        const root = await createRoot();
        await createCharacterGroup(root, "fantasy", {
            name: "Fantasy",
            description: "Original cast",
        });
        await writeCharacterVisual(root, "alice", {
            schema: "nbook.character-visual/v1",
            characterId: "alice",
            character: {cnName: "Alice", triggerWords: "alice"},
            outfits: [],
            photos: [],
        }, "fantasy");

        await expect(updateCharacterGroup(root, "fantasy", {
            name: "Main Cast",
            description: "Updated cast",
        })).resolves.toEqual({
            groupId: "fantasy",
            name: "Main Cast",
            description: "Updated cast",
        });

        await expect(listCharacterGroups(root)).resolves.toEqual([{
            groupId: "fantasy",
            name: "Main Cast",
            description: "Updated cast",
        }]);
        await expect(readCharacterVisual(root, "alice", "fantasy")).resolves.toMatchObject({
            characterId: "alice",
            character: {cnName: "Alice"},
        });
    });
});

async function createRoot(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "nbook-character-group-"));
    temporaryDirectories.push(directory);
    return directory;
}
