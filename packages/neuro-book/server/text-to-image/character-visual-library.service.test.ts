import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    CharacterVisualLibraryService,
    CharacterVisualRevisionConflictError,
    VisualDeleteRevisionConflictError,
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

    it("supports multiple groups and enabled priority", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "故事后期"});
        await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "default"));
        await service.write(root, {groupId: late.groupId, characterId: "hero"}, makeVisual("hero", "late"));
        await service.setEnabledGroups(root, ["default", late.groupId]);
        await service.reorderGroups(root, [late.groupId, "default"]);

        const effective = await service.getEffectiveVisuals(root);
        expect(effective).toHaveLength(1);
        expect(effective[0]).toMatchObject({groupId: late.groupId, characterId: "hero", visual: {character: {profileTraits: "late"}}});
        expect((await service.listCharacters(root, "default")).map((item) => item.characterId)).toEqual(["hero"]);
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

    it("previews and deletes the active visual with an atomic fallback", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const first = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "first"));
        const second = await service.createNewVersion(root, {groupId: "default", characterId: "hero", baseVisualId: first.ref.visualId}, makeVisual("hero", "second"));
        await mkdir(path.join(root, ".nbook"), {recursive: true});
        await writeFile(path.join(root, ".nbook", "text-to-image-send-data.json"), JSON.stringify({
            lorebookPaths: [],
            characterIds: ["hero"],
            characterSelections: [{characterId: "hero", groupId: "default", visualId: second.ref.visualId}],
            outfitSelections: [],
        }), "utf8");
        const preview = await service.previewDeleteVisual(root, second.ref);
        expect(preview).toMatchObject({active: true, remainingVisualCount: 1, characterWillDisappear: false, fallback: {visualId: first.ref.visualId}});
        await expect(service.deleteVisual(root, second.ref, preview.revision)).resolves.toMatchObject({fallback: {visualId: first.ref.visualId}});
        await expect(service.read(root, first.ref)).resolves.toMatchObject({character: {profileTraits: "first"}});
        await expect(service.read(root, second.ref)).resolves.toBeNull();
        expect(JSON.parse(await readFile(path.join(root, ".nbook", "text-to-image-send-data.json"), "utf8"))).toMatchObject({
            characterSelections: [{characterId: "hero", groupId: "default", visualId: first.ref.visualId}],
        });
    });

    it("allows deleting the last visual without removing the original character record", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const visual = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero"));
        const preview = await service.previewDeleteVisual(root, visual.ref);
        expect(preview).toMatchObject({characterWillDisappear: true, remainingVisualCount: 0});
        await service.deleteVisual(root, visual.ref, preview.revision);
        expect(await service.listCharacters(root, "default")).toEqual([]);
        expect(await service.listGroups(root)).toEqual([expect.objectContaining({groupId: "default", characterCount: 0})]);
    });

    it("rejects deletion when the preview revision is stale", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const visual = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero"));
        const preview = await service.previewDeleteVisual(root, visual.ref);
        await service.write(root, visual.ref, makeVisual("hero", "changed"), {expectedUpdatedAt: visual.info.updatedAt});
        await expect(service.deleteVisual(root, visual.ref, preview.revision)).rejects.toBeInstanceOf(VisualDeleteRevisionConflictError);
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
