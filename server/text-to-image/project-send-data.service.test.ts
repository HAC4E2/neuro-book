import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    listProjectSendDataOptions,
    readProjectSendData,
    readProjectSendDataSnapshot,
    writeProjectSendData,
} from "nbook/server/text-to-image/project-send-data.service";

const temporaryRoots: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
});

describe("project send data service", () => {
    it("round-trips project selections without creating a default group", async () => {
        const root = await createProject();

        await expect(readProjectSendData(root)).resolves.toMatchObject({
            lorebookPaths: [],
            characterIds: [],
            characterSelections: [],
            outfitSelections: [],
        });
        await writeProjectSendData(root, {
            lorebookPaths: ["lorebook/world/setting/index.md"],
            characterIds: ["lin-yanzhou"],
            characterSelections: [{characterId: "lin-yanzhou", groupId: null}],
            outfitSelections: [{characterId: "lin-yanzhou", name: "校服"}],
        });

        await expect(readProjectSendData(root)).resolves.toMatchObject({
            lorebookPaths: ["lorebook/world/setting/index.md"],
            characterIds: ["lin-yanzhou"],
            characterSelections: [{characterId: "lin-yanzhou", groupId: null}],
            outfitSelections: [{characterId: "lin-yanzhou", name: "校服"}],
        });
        await expect(fs.stat(path.join(root, "lorebook", "character", "default"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("lists lorebook entries and visual characters as separate choices", async () => {
        const root = await createProject();
        await fs.mkdir(path.join(root, "lorebook", "world", "setting"), {recursive: true});
        await fs.writeFile(path.join(root, "lorebook", "world", "setting", "index.md"), "# 世界设定\n\n夜城在海边。\n", "utf8");
        await fs.mkdir(path.join(root, "lorebook", "character", "lin-yanzhou"), {recursive: true});
        await fs.writeFile(path.join(root, "lorebook", "character", "lin-yanzhou", "visual.json"), JSON.stringify({
            schema: "nbook.character-visual/v1",
            characterId: "lin-yanzhou",
            character: {cnName: "林砚舟", enName: "Lin Yanzhou", triggerWords: "林砚舟,Lin Yanzhou"},
            outfits: [{cnName: "校服", enName: "school uniform", upper: "white shirt", upperBack: "white shirt back", lower: "navy skirt", lowerBack: "navy skirt back"}],
            photos: [],
        }), "utf8");

        const options = await listProjectSendDataOptions(root);
        expect(options.lorebookEntries).toEqual([{path: "lorebook/world/setting/index.md", title: "世界设定"}]);
        expect(options.characters).toEqual([{
            characterId: "lin-yanzhou",
            groupId: null,
            cnName: "林砚舟",
            enName: "Lin Yanzhou",
            outfits: [{name: "校服", cnName: "校服", enName: "school uniform"}],
        }]);
    });

    it("freezes selected content server-side and ignores stale files", async () => {
        const root = await createProject();
        await fs.mkdir(path.join(root, "lorebook", "world", "setting"), {recursive: true});
        await fs.writeFile(path.join(root, "lorebook", "world", "setting", "index.md"), "setting content", "utf8");

        const snapshot = await readProjectSendDataSnapshot(root, {
            lorebookPaths: ["lorebook/world/setting/index.md", "lorebook/world/missing/index.md"],
            characterIds: ["missing"],
            outfitSelections: [],
        });
        expect(snapshot.lorebookEntries).toEqual([{path: "lorebook/world/setting/index.md", content: "setting content"}]);
        expect(snapshot.characters).toEqual([]);
        expect(snapshot.outfits).toEqual([]);
        expect(snapshot.missingItems).toEqual([
            "lorebook/world/missing/index.md",
            "character:legacy/missing",
        ]);
    });

    it("rejects absolute paths, traversal and non-entry files", async () => {
        const root = await createProject();
        await expect(writeProjectSendData(root, {
            lorebookPaths: ["../outside/index.md"],
            characterIds: [],
            outfitSelections: [],
        })).rejects.toThrow();
        await expect(writeProjectSendData(root, {
            lorebookPaths: ["lorebook/world/setting/state.md"],
            characterIds: [],
            outfitSelections: [],
        })).rejects.toThrow();
    });
});

async function createProject(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-send-data-"));
    temporaryRoots.push(root);
    return root;
}
