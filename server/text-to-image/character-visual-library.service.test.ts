import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    CharacterVisualLibraryService,
    CharacterVisualRevisionConflictError,
} from "nbook/server/text-to-image/character-visual-library.service";
import type {CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("CharacterVisualLibraryService", () => {
    it("creates the default group and keeps Unicode character IDs", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const visual = makeVisual("艾璃丝·赛瑞利亚");

        const result = await service.write(root, {groupId: "default", characterId: visual.characterId}, visual);

        expect(result.info.fileName).toBe("visual.json");
        expect((await service.listTree(root))[0]).toMatchObject({groupId: "default", characterCount: 1});
        await expect(service.read(root, result.ref)).resolves.toMatchObject({characterId: visual.characterId});
    });

    it("supports multiple groups, enabled priority and copying a visual", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        await service.createGroup(root, "late", {name: "故事后期"});
        await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "default"));
        await service.write(root, {groupId: "late", characterId: "hero"}, makeVisual("hero", "late"));
        await service.setEnabledGroups(root, ["default", "late"]);
        await service.reorderGroups(root, ["late", "default"]);

        const effective = await service.getEffectiveVisuals(root);
        expect(effective).toHaveLength(1);
        expect(effective[0]).toMatchObject({groupId: "late", characterId: "hero", visual: {character: {profileTraits: "late"}}});

        const source = (await service.readWithInfo(root, {groupId: "late", characterId: "hero"}))!;
        const copied = await service.createCopy(root, {
            groupId: "late",
            characterId: "hero",
            visualId: source.info.visualId,
        }, {groupId: "default", characterId: "side"});
        expect(copied.info.fileName).toBe("visual.json");
        expect((await service.listCharacters(root, "default")).map((item) => item.characterId)).toEqual(["hero", "side"]);
    });

    it("creates collision-free versions, renames safely and rejects stale writes", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const first = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "one"));
        const second = await service.createNewVersion(root, {groupId: "default", characterId: "hero", baseVisualId: first.ref.visualId}, makeVisual("hero", "two"), {expectedUpdatedAt: first.info.updatedAt});
        expect(second.info.fileName).toMatch(/^visual-\d{8}T\d{9}Z-[0-9a-f]{8}\.json$/u);
        await expect(service.renameVisual(root, second.ref, "after-story")).resolves.toMatchObject({fileName: "after-story.json"});
        await service.write(root, first.ref, makeVisual("hero", "updated"), {expectedUpdatedAt: first.info.updatedAt, setActive: false});
        await expect(service.write(root, first.ref, makeVisual("hero", "stale"), {expectedUpdatedAt: first.info.updatedAt})).rejects.toBeInstanceOf(CharacterVisualRevisionConflictError);
        const manifest = JSON.parse(await readFile(path.join(root, ".nbook", "text-to-image", "character-groups", "default", "hero", "manifest.json"), "utf8")) as {activeVisualId: string};
        expect(manifest.activeVisualId).toBe(second.ref.visualId);
    });

    it("shows malformed files in the tree instead of hiding the character", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        await service.write(root, {groupId: "default", characterId: "broken"}, makeVisual("broken"));
        const filePath = path.join(root, ".nbook", "text-to-image", "character-groups", "default", "broken", "visual.json");
        await import("node:fs/promises").then(({writeFile}) => writeFile(filePath, "{broken", "utf8"));
        const tree = await service.listTree(root);
        expect(tree[0]?.characters[0]?.files[0]?.invalid).toBe(true);
    });

    it("migrates legacy grouped and ungrouped visual files once", async () => {
        const root = await createRoot();
        const legacyCharacter = path.join(root, "lorebook", "character", "艾璃丝·赛瑞利亚");
        const legacyGroupCharacter = path.join(root, "lorebook", "character", "late", "hero");
        await mkdir(legacyCharacter, {recursive: true});
        await mkdir(legacyGroupCharacter, {recursive: true});
        await writeFile(path.join(legacyCharacter, "visual.json"), JSON.stringify(makeVisual("艾璃丝·赛瑞利亚")), "utf8");
        await writeFile(path.join(legacyGroupCharacter, "visual.json"), JSON.stringify(makeVisual("hero", "late")), "utf8");

        const service = new CharacterVisualLibraryService();
        const groups = await service.listTree(root);
        expect(groups.map((group) => group.groupId)).toEqual(["default", "late"]);
        expect(groups.find((group) => group.groupId === "late")?.enabled).toBe(true);
        expect(await service.read(root, {groupId: "default", characterId: "艾璃丝·赛瑞利亚"})).toMatchObject({characterId: "艾璃丝·赛瑞利亚"});
        expect(await service.read(root, {groupId: "late", characterId: "hero"})).toMatchObject({character: {profileTraits: "late"}});
    });
});

async function createRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "nbook-character-library-"));
    roots.push(root);
    return root;
}

function makeVisual(characterId: string, profileTraits = "traits"): CharacterVisualFile {
    return {
        schema: "nbook.character-visual/v1",
        characterId,
        character: {cnName: characterId, profileTraits},
        outfits: [],
        photos: [],
    };
}
