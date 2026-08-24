import fs from "node:fs/promises";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    CharacterIdentityDamagedFileError,
    CharacterIdentityRevisionConflictError,
    readCharacterIdentitySummary,
    updateCharacterIdentity,
    type CharacterIdentity,
    type IdentityTransactionDependencies,
} from "nbook/server/text-to-image/character-identity.service";
import {
    CharacterIdentityFieldConflictError,
    CharacterVisualLibraryService,
} from "nbook/server/text-to-image/character-visual-library.service";
import type {CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
});

describe("角色身份一致性", () => {
    it("修改身份后同一 characterId 跨分组、跨 JSON 版本全部同步", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const first = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "旧名", "Old", "旧 | 老"));
        const second = await service.createNewVersion(root, {groupId: "default", characterId: "hero", baseVisualId: first.ref.visualId}, makeVisual("hero", "旧名", "Old", "旧 | 老", "late traits"));
        const late = await service.createGroup(root, {name: "后期"});
        await service.write(root, {groupId: late.groupId, characterId: "hero"}, makeVisual("hero", "旧名", "Old", "旧 | 老", "late group traits"));

        const summary = await readCharacterIdentitySummary(root, "hero");
        expect(summary.fileCount).toBe(3);
        expect(summary.groupCount).toBe(2);

        const result = await updateCharacterIdentity({
            projectRoot: root,
            characterId: "hero",
            identity: {cnName: "新名", enName: "New", triggerWords: "新 | new"},
            selectedVisual: null,
            expectedIdentityRevision: summary.revision,
        });
        expect(result.updatedFileCount).toBe(3);
        expect(result.identity).toEqual({cnName: "新名", enName: "New", triggerWords: "新 | new"});

        for (const ref of [first.ref, second.ref, {groupId: late.groupId, characterId: "hero", visualId: (await service.read(root, {groupId: late.groupId, characterId: "hero"}))!.visualId!}]) {
            const visual = await service.read(root, ref);
            expect(visual?.character.cnName).toBe("新名");
            expect(visual?.character.enName).toBe("New");
            expect(visual?.character.triggerWords).toBe("新 | new");
        }
    });

    it("普通视觉编辑不改变身份；隐式修改身份字段的普通保存被拒绝", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const first = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "旧名", "Old", "旧 | 老"));

        // 普通保存修改外貌字段：身份字段与磁盘基线完全一致。
        const patched = makeVisual("hero", "旧名", "Old", "旧 | 老", "new hair");
        const updated = await service.write(root, first.ref, patched, {expectedUpdatedAt: first.info.updatedAt, setActive: false});
        expect(updated.visual.character.cnName).toBe("旧名");
        expect(updated.visual.character.triggerWords).toBe("旧 | 老");

        // 普通保存试图改中文名：拒绝，不得产生身份分叉。
        await expect(service.write(root, first.ref, makeVisual("hero", "偷偷改", "Old", "旧 | 老"), {
            expectedUpdatedAt: updated.info.updatedAt,
        })).rejects.toBeInstanceOf(CharacterIdentityFieldConflictError);
    });

    it("修改中文名不累积旧中文名，修改英文名不写入显式触发词", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "旧名", "Old", "旧名 | Old | 老"));

        const summary = await readCharacterIdentitySummary(root, "hero");
        await updateCharacterIdentity({
            projectRoot: root,
            characterId: "hero",
            identity: {cnName: "新名", enName: "New", triggerWords: "老"},
            selectedVisual: null,
            expectedIdentityRevision: summary.revision,
        });

        const visual = await service.read(root, {groupId: "default", characterId: "hero"});
        expect(visual?.character.cnName).toBe("新名");
        expect(visual?.character.triggerWords).toBe("老");
    });

    it("同时修改身份和当前视觉作为一个事务提交", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const first = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "旧名", "Old", "旧 | 老", "old traits"));
        await service.createNewVersion(root, {groupId: "default", characterId: "hero", baseVisualId: first.ref.visualId}, makeVisual("hero", "旧名", "Old", "旧 | 老", "other version"));

        const summary = await readCharacterIdentitySummary(root, "hero");
        const patch: CharacterVisualFile = {
            ...makeVisual("hero", "新名", "New", "新 | new", "new traits"),
            outfits: [{cnName: "礼服", enName: "Dress", upper: "gown", upperBack: "", lower: "", lowerBack: ""}],
            photos: ["assets/tti/hero.png"],
        };
        const result = await updateCharacterIdentity({
            projectRoot: root,
            characterId: "hero",
            identity: {cnName: "新名", enName: "New", triggerWords: "新 | new"},
            selectedVisual: {
                groupId: first.ref.groupId,
                visualId: first.ref.visualId,
                expectedUpdatedAt: first.info.updatedAt,
                visual: patch,
            },
            expectedIdentityRevision: summary.revision,
        });

        expect(result.updatedFileCount).toBe(2);
        const selected = await service.read(root, {groupId: "default", characterId: "hero", visualId: first.ref.visualId});
        expect(selected?.character.profileTraits).toBe("new traits");
        expect(selected?.outfits[0]?.cnName).toBe("礼服");
        expect(selected?.photos).toEqual(["assets/tti/hero.png"]);
        expect(selected?.character.cnName).toBe("新名");
        const otherFiles = (await service.listVisualFiles(root, {groupId: "default", characterId: "hero"}))
            .filter((file) => file.visualId !== first.ref.visualId);
        const other = await service.read(root, {groupId: "default", characterId: "hero", visualId: otherFiles[0]!.visualId});
        expect(other?.character.cnName).toBe("新名");
        expect(other?.character.profileTraits).toBe("other version");
    });

    it("revision 过期返回 409，所有文件保持原值", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "旧名", "Old", "旧 | 老"));
        const stale = "stale-revision";

        await expect(updateCharacterIdentity({
            projectRoot: root,
            characterId: "hero",
            identity: {cnName: "新名", enName: "New", triggerWords: "新 | new"},
            selectedVisual: null,
            expectedIdentityRevision: stale,
        })).rejects.toBeInstanceOf(CharacterIdentityRevisionConflictError);

        const visual = await service.read(root, {groupId: "default", characterId: "hero"});
        expect(visual?.character.cnName).toBe("旧名");
    });

    it("某一相关 JSON 损坏时身份保存整体失败并列出安全文件标识", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "旧名", "Old", "旧 | 老"));
        await service.createNewVersion(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "旧名", "Old", "旧 | 老"));
        const files = await service.listVisualFiles(root, {groupId: "default", characterId: "hero"});
        const broken = files.find((file) => file.fileName !== "visual.json")!;
        await fs.writeFile(path.join(root, ".nbook", "text-to-image", "character-groups", "default", "hero", broken.fileName), "{broken", "utf8");

        await expect(updateCharacterIdentity({
            projectRoot: root,
            characterId: "hero",
            identity: {cnName: "新名", enName: "New", triggerWords: "新 | new"},
            selectedVisual: null,
            expectedIdentityRevision: null,
        })).rejects.toBeInstanceOf(CharacterIdentityDamagedFileError);
    });

    it("身份更新不改变 visualId、文件名、服装、照片和非身份字段", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const input = makeVisual("hero", "旧名", "Old", "旧 | 老", "traits");
        input.outfits = [{cnName: "校服", enName: "Uniform", upper: "shirt", upperBack: "", lower: "skirt", lowerBack: ""}];
        input.photos = ["assets/tti/hero.png"];
        const first = await service.write(root, {groupId: "default", characterId: "hero"}, input);
        const summary = await readCharacterIdentitySummary(root, "hero");

        await updateCharacterIdentity({
            projectRoot: root,
            characterId: "hero",
            identity: {cnName: "新名", enName: "New", triggerWords: "新 | new"},
            selectedVisual: null,
            expectedIdentityRevision: summary.revision,
        });

        const visual = await service.read(root, {groupId: "default", characterId: "hero"});
        expect(visual?.visualId).toBe(first.ref.visualId);
        expect(visual?.characterId).toBe("hero");
        expect(visual?.character.profileTraits).toBe("traits");
        expect(visual?.outfits).toEqual(input.outfits);
        expect(visual?.photos).toEqual(input.photos);
    });

    it("故障注入后回滚：身份与视觉修改都不落盘", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const first = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "旧名", "Old", "旧 | 老", "old traits"));
        const summary = await readCharacterIdentitySummary(root, "hero");
        const options: IdentityTransactionDependencies = {failAt: "commit_files"};
        const identity: CharacterIdentity = {cnName: "新名", enName: "New", triggerWords: "新 | new"};

        await expect(updateCharacterIdentity({
            projectRoot: root,
            characterId: "hero",
            identity,
            selectedVisual: {
                groupId: first.ref.groupId,
                visualId: first.ref.visualId,
                expectedUpdatedAt: first.info.updatedAt,
                visual: makeVisual("hero", "新名", "New", "新 | new", "patched"),
            },
            expectedIdentityRevision: summary.revision,
        }, options)).rejects.toThrow("故障注入");

        const visual = await service.read(root, {groupId: "default", characterId: "hero"});
        expect(visual?.character.cnName).toBe("旧名");
        expect(visual?.character.profileTraits).toBe("old traits");
        expect(visual?.character.triggerWords).toBe("旧 | 老");
        const summaryAfter = await readCharacterIdentitySummary(root, "hero");
        expect(summaryAfter.revision).toBe(summary.revision);
    });
});

async function createRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "nbook-identity-"));
    roots.push(root);
    return root;
}

function makeVisual(characterId: string, cnName: string, enName: string, triggerWords: string, profileTraits = "traits"): CharacterVisualFile {
    return {
        schema: "nbook.character-visual/v1",
        characterId,
        character: {cnName, enName, triggerWords, profileTraits},
        outfits: [],
        photos: [],
    };
}
