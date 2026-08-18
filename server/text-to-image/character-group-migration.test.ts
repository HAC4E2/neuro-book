import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it} from "vitest";
import {
    CharacterVisualLibraryService,
    GroupNameConflictError,
} from "nbook/server/text-to-image/character-visual-library.service";
import {GroupMigrationRevisionConflictError} from "nbook/server/text-to-image/character-group-migration";
import type {CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("CharacterVisualLibraryService 分组创建与名称合同", () => {
    it("服务端生成稳定的 group-* ID，重命名不改变 ID", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const created = await service.createGroup(root, {name: "故事后期"});
        expect(created.groupId).toMatch(/^group-[0-9a-f-]{36}$/u);
        expect(created.name).toBe("故事后期");
        const renamed = await service.updateGroup(root, created.groupId, {name: "故事后期（改名）"});
        expect(renamed.groupId).toBe(created.groupId);
        const groups = await service.listGroups(root);
        expect(groups.map((group) => group.groupId)).toEqual(expect.arrayContaining([created.groupId]));
    });

    it("同名创建与同名重命名返回冲突，且名称比较大小写不敏感", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        await service.createGroup(root, {name: "后期"});
        await expect(service.createGroup(root, {name: "后期"})).rejects.toBeInstanceOf(GroupNameConflictError);
        await expect(service.createGroup(root, {name: " 后期 "})).rejects.toBeInstanceOf(GroupNameConflictError);
        const other = await service.createGroup(root, {name: "前期"});
        await expect(service.updateGroup(root, other.groupId, {name: "后期"})).rejects.toBeInstanceOf(GroupNameConflictError);
        // 保留自己的名称不算冲突。
        await expect(service.updateGroup(root, other.groupId, {name: "前期"})).resolves.toMatchObject({name: "前期"});
    });

    it("ID 生成碰撞时重新生成，不产生重复 ID", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const first = await service.createGroup(root, {name: "第一个"});
        // 注入的生成器第一次返回已有 ID，验证碰撞重试路径。
        let calls = 0;
        const second = await service.createGroup(root, {name: "第二个"}, {
            nextGroupId: () => {
                calls += 1;
                return calls === 1 ? first.groupId : `group-${randomUUID()}`;
            },
        });
        expect(calls).toBe(2);
        expect(second.groupId).not.toBe(first.groupId);
        const groups = await service.listGroups(root);
        expect(new Set(groups.map((group) => group.groupId)).size).toBe(groups.length);
    });

    it("拒绝空名称", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        await expect(service.createGroup(root, {name: "   "})).rejects.toThrow("分组名称不能为空");
    });

    it("default 分组永远不能删除", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        await expect(service.previewDeleteGroup(root, "default")).rejects.toThrow("default 分组不能删除");
        await expect(service.deleteGroupWithMigration(root, "default", "revision")).rejects.toThrow("default 分组不能删除");
    });

    it("删除空分组：视觉资料树只剩 default", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const empty = await service.createGroup(root, {name: "空组"});
        const preview = await service.previewDeleteGroup(root, empty.groupId);
        expect(preview).toMatchObject({groupId: empty.groupId, characterCount: 0, visualCount: 0, defaultEnabled: true});
        const result = await service.deleteGroupWithMigration(root, empty.groupId, preview.revision);
        expect(result.moved).toEqual({characterCount: 0, visualCount: 0});
        expect((await service.listTree(root)).map((group) => group.groupId)).toEqual(["default"]);
    });
});

describe("CharacterVisualLibraryService 分组删除迁移", () => {
    it("default 无同角色时整目录迁移，角色数/视觉数/字节不变", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        const first = await service.write(root, {groupId: late.groupId, characterId: "hero"}, makeVisual("hero", "后期一套"));
        const second = await service.createNewVersion(root, {
            groupId: late.groupId,
            characterId: "hero",
            baseVisualId: first.ref.visualId,
        }, makeVisual("hero", "后期二套"));
        await service.write(root, {groupId: late.groupId, characterId: "艾璃丝"}, makeVisual("艾璃丝", "后期"));
        const firstPath = path.join(root, ".nbook", "text-to-image", "character-groups", late.groupId, "hero", first.info.fileName);
        const secondPath = path.join(root, ".nbook", "text-to-image", "character-groups", late.groupId, "hero", second.info.fileName);
        const firstBytes = await readFile(firstPath);
        const secondBytes = await readFile(secondPath);

        const preview = await service.previewDeleteGroup(root, late.groupId);
        expect(preview).toMatchObject({characterCount: 2, visualCount: 3, invalidFileCount: 0, fileNameConflictCount: 0, visualIdConflictCount: 0});
        const result = await service.deleteGroupWithMigration(root, late.groupId, preview.revision);
        expect(result.moved).toEqual({characterCount: 2, visualCount: 3});
        expect(result.refMap).toHaveLength(3);
        expect(result.refMap.every((mapping) => mapping.next.groupId === "default")).toBe(true);

        const tree = await service.listTree(root);
        expect(tree.map((group) => group.groupId)).toEqual(["default"]);
        const defaultGroup = tree[0]!;
        expect(defaultGroup.characters.map((item) => item.characterId).sort()).toEqual(["hero", "艾璃丝"]);
        expect(defaultGroup.characters.find((item) => item.characterId === "hero")?.files).toHaveLength(2);
        // 整目录迁移后文件字节不变（文件名、manifest 不变）。
        expect((await readFile(path.join(root, ".nbook", "text-to-image", "character-groups", "default", "hero", first.info.fileName))).equals(firstBytes)).toBe(true);
        expect((await readFile(path.join(root, ".nbook", "text-to-image", "character-groups", "default", "hero", second.info.fileName))).equals(secondBytes)).toBe(true);
        // 来源组目录已删除。
        await expect(readFile(firstPath)).rejects.toThrow();
    });

    it("default 已有同角色：合并 manifest、大小写文件名冲突重命名、visualId 冲突生成新 ID", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        // default/hero 一份（文件名 Visual.JSON，生效）。
        const target = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "default 版"), {fileName: "Visual.JSON"});
        // late/hero 第一份：同 visualId + 同名（大小写）→ 双重冲突。
        const conflicting = await service.write(root, {
            groupId: late.groupId,
            characterId: "hero",
            visualId: target.ref.visualId,
        }, makeVisual("hero", "后期版"), {allowCreate: true});
        const extra = await service.createNewVersion(root, {
            groupId: late.groupId,
            characterId: "hero",
            baseVisualId: conflicting.ref.visualId,
        }, makeVisual("hero", "后期追加版"));

        const preview = await service.previewDeleteGroup(root, late.groupId);
        expect(preview).toMatchObject({characterCount: 1, visualCount: 2, fileNameConflictCount: 1, visualIdConflictCount: 1});
        const result = await service.deleteGroupWithMigration(root, late.groupId, preview.revision);

        const conflictMapping = result.refMap.find((mapping) => mapping.old.visualId === conflicting.ref.visualId);
        expect(conflictMapping?.next.visualId).not.toBe(conflicting.ref.visualId);
        const unchangedMapping = result.refMap.find((mapping) => mapping.old.visualId === extra.ref.visualId);
        expect(unchangedMapping?.next.visualId).toBe(extra.ref.visualId);

        const defaultCharacters = await service.listCharacters(root, "default");
        const hero = defaultCharacters.find((item) => item.characterId === "hero");
        expect(hero?.files).toHaveLength(3);
        const names = hero!.files.map((file) => file.fileName.toLocaleLowerCase());
        expect(new Set(names).size).toBe(3);
        expect(hero!.files.some((file) => /^visual-moved-[0-9a-f]{8}\.json$/iu.test(file.fileName))).toBe(true);
        // 目标原有生效视觉保持不变。
        const manifest = JSON.parse(await readFile(path.join(root, ".nbook", "text-to-image", "character-groups", "default", "hero", "manifest.json"), "utf8")) as {activeVisualId: string};
        expect(manifest.activeVisualId).toBe(target.ref.visualId);
        // 内容 visualId 已同步改写，其余字段保留。
        const moved = await service.read(root, {groupId: "default", characterId: "hero", visualId: conflictMapping!.next.visualId});
        expect(moved).toMatchObject({character: {profileTraits: "后期版"}});
    });

    it("目标角色没有合法生效项时继承来源生效视觉", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "default 版"));
        const first = await service.write(root, {groupId: late.groupId, characterId: "hero"}, makeVisual("hero", "后期一"));
        const active = await service.createNewVersion(root, {groupId: late.groupId, characterId: "hero", baseVisualId: first.ref.visualId}, makeVisual("hero", "后期二（生效）"));
        // 目标 activeVisualId 置空（模拟没有合法生效项）。
        const manifestPath = path.join(root, ".nbook", "text-to-image", "character-groups", "default", "hero", "manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {activeVisualId: string | null};
        manifest.activeVisualId = null;
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

        const preview = await service.previewDeleteGroup(root, late.groupId);
        await service.deleteGroupWithMigration(root, late.groupId, preview.revision);
        const merged = JSON.parse(await readFile(manifestPath, "utf8")) as {activeVisualId: string | null};
        expect(merged.activeVisualId).toBe(active.ref.visualId);
    });

    it("损坏 JSON 按原始字节迁移并保持错误节点可见", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        const written = await service.write(root, {groupId: late.groupId, characterId: "broken"}, makeVisual("broken"));
        const filePath = path.join(root, ".nbook", "text-to-image", "character-groups", late.groupId, "broken", written.info.fileName);
        const brokenBytes = Buffer.from("{broken-json", "utf8");
        await writeFile(filePath, brokenBytes);

        const preview = await service.previewDeleteGroup(root, late.groupId);
        expect(preview.invalidFileCount).toBe(1);
        await service.deleteGroupWithMigration(root, late.groupId, preview.revision);

        const moved = path.join(root, ".nbook", "text-to-image", "character-groups", "default", "broken", written.info.fileName);
        expect((await readFile(moved)).equals(brokenBytes)).toBe(true);
        const tree = await service.listTree(root);
        expect(tree[0]?.characters[0]?.files[0]?.invalid).toBe(true);
    });

    it("照片引用保留，角色 Markdown 不变", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        const visual = makeVisual("hero", "后期");
        visual.photos = ["assets/tti/photo-1.png"];
        const written = await service.write(root, {groupId: late.groupId, characterId: "hero"}, visual);
        // 角色原始 Markdown 在视觉库之外，迁移不得触碰。
        await import("node:fs/promises").then(async ({mkdir, writeFile}) => {
            await mkdir(path.join(root, "lorebook", "character", "hero"), {recursive: true});
            await writeFile(path.join(root, "lorebook", "character", "hero", "index.md"), "# hero\n正文", "utf8");
        });

        const preview = await service.previewDeleteGroup(root, late.groupId);
        await service.deleteGroupWithMigration(root, late.groupId, preview.revision);
        const moved = await service.read(root, {groupId: "default", characterId: "hero", visualId: written.ref.visualId});
        expect(moved?.photos).toEqual(["assets/tti/photo-1.png"]);
        expect(await readFile(path.join(root, "lorebook", "character", "hero", "index.md"), "utf8")).toBe("# hero\n正文");
    });

    it("删除已启用来源组后只从启用集合移除来源 ID，default 不被隐式启用", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        await service.write(root, {groupId: late.groupId, characterId: "hero"}, makeVisual("hero", "后期"));
        await service.setEnabledGroups(root, [late.groupId]);

        const preview = await service.previewDeleteGroup(root, late.groupId);
        expect(preview.defaultEnabled).toBe(false);
        await service.deleteGroupWithMigration(root, late.groupId, preview.revision);

        const groups = await service.listGroups(root);
        expect(groups[0]).toMatchObject({groupId: "default", enabled: false});
    });

    it("受管引用按 ref 映射更新：send-data 中 groupId 与 visualId 同步改写", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        // default 已有同角色，强制 visualId 冲突以验证映射。
        const target = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "default"));
        const source = await service.write(root, {
            groupId: late.groupId,
            characterId: "hero",
            visualId: target.ref.visualId,
        }, makeVisual("hero", "后期"), {allowCreate: true});
        await writeFile(path.join(root, ".nbook", "text-to-image-send-data.json"), JSON.stringify({
            lorebookPaths: [],
            characterIds: ["hero"],
            characterSelections: [{characterId: "hero", groupId: late.groupId, visualId: source.ref.visualId}],
            outfitSelections: [{characterId: "hero", groupId: late.groupId, visualId: source.ref.visualId, name: "晚礼服"}],
        }, null, 2), "utf8");

        const preview = await service.previewDeleteGroup(root, late.groupId);
        expect(preview.managedReferenceCount).toBe(2);
        const result = await service.deleteGroupWithMigration(root, late.groupId, preview.revision);

        const sendData = JSON.parse(await readFile(path.join(root, ".nbook", "text-to-image-send-data.json"), "utf8")) as {
            characterSelections: Array<{characterId: string; groupId: string; visualId: string}>;
            outfitSelections: Array<{characterId: string; groupId: string; visualId: string}>;
        };
        const mappedId = result.refMap.find((mapping) => mapping.old.visualId === source.ref.visualId)!.next.visualId;
        expect(sendData.characterSelections[0]).toEqual({characterId: "hero", groupId: "default", visualId: mappedId});
        expect(sendData.outfitSelections[0]).toMatchObject({groupId: "default", visualId: mappedId});
    });

    it("预检后数据变化时提交返回 revision 冲突", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        await service.write(root, {groupId: late.groupId, characterId: "hero"}, makeVisual("hero", "一"));
        const preview = await service.previewDeleteGroup(root, late.groupId);
        // 预检后新增一个角色 → 状态变化。
        await service.write(root, {groupId: late.groupId, characterId: "side"}, makeVisual("side", "新角色"));

        await expect(service.deleteGroupWithMigration(root, late.groupId, preview.revision)).rejects.toBeInstanceOf(GroupMigrationRevisionConflictError);
        // 来源组保持完整可用。
        const tree = await service.listTree(root);
        const lateTree = tree.find((group) => group.groupId === late.groupId);
        expect(lateTree?.characters.map((item) => item.characterId).sort()).toEqual(["hero", "side"]);
    });

    it.each([
        "stage", "verify", "backup", "commit_files", "commit_groups", "commit_refs", "remove_source",
    ] as const)("故障注入 %s：回滚后来源组、default、清单与引用全部保持原状", async (failAt) => {
        const fixture = await seedMergeFixture();
        const {root, service, late, snapshot} = fixture;
        const preview = await service.previewDeleteGroup(root, late.groupId);

        await expect(service.deleteGroupWithMigration(root, late.groupId, preview.revision, {failAt})).rejects.toThrow(`故障注入：${failAt}`);
        await expectNoTransactionLeftovers(root);
        await expectStateMatchesSnapshot(root, service, snapshot);
    });

    it("重启后识别未完成事务并恢复原状", async () => {
        const fixture = await seedMergeFixture();
        const {root, service, late, snapshot} = fixture;
        const {mkdir, rename, copyFile} = await import("node:fs/promises");

        // 手工构造一次“崩溃”现场：备份已完成但未提交，日志状态停在 backed-up。
        const libraryRoot = path.join(root, ".nbook", "text-to-image");
        const transactionId = randomUUID();
        const transactionRoot = path.join(libraryRoot, ".txn");
        const transactionDirectory = path.join(transactionRoot, transactionId);
        const backup = path.join(transactionDirectory, "backup");
        const groupDirectory = path.join(libraryRoot, "character-groups");
        await mkdir(path.join(backup, "default"), {recursive: true});
        await mkdir(path.join(backup, "source"), {recursive: true});
        await rename(path.join(groupDirectory, "default", "hero"), path.join(backup, "default", "hero"));
        await rename(path.join(groupDirectory, late.groupId, "hero"), path.join(backup, "source", "hero"));
        await rename(path.join(groupDirectory, late.groupId, "side"), path.join(backup, "source", "side"));
        await copyFile(path.join(libraryRoot, "character-groups.json"), path.join(backup, "character-groups.json"));
        await writeFile(path.join(transactionRoot, `${transactionId}.json`), JSON.stringify({
            kind: "group-migration-v1",
            version: 1,
            transactionId,
            state: "backed-up",
            createdAt: new Date(0).toISOString(),
            payload: {
                groupId: late.groupId,
                sourceGroupDirectory: path.join(groupDirectory, late.groupId),
                backedUpDefaultDirectories: ["hero"],
                builtTargetDirectories: [],
                movedWholeDirectories: [],
                movedSourceEntries: ["hero", "side"],
                groupsBackedUp: true,
                sendDataBackedUp: false,
            },
        }, null, 2), "utf8");

        // 下一次库操作触发恢复。
        await service.listTree(root);
        await expectNoTransactionLeftovers(root);
        await expectStateMatchesSnapshot(root, service, snapshot);
    });

    it("迁移前后角色数、视觉文件数、字节数一致", async () => {
        const fixture = await seedMergeFixture();
        const {root, service, late, snapshot} = fixture;
        const preview = await service.previewDeleteGroup(root, late.groupId);
        const result = await service.deleteGroupWithMigration(root, late.groupId, preview.revision);

        expect(result.moved).toEqual({characterCount: 2, visualCount: 3});
        const tree = await service.listTree(root);
        expect(tree).toHaveLength(1);
        const defaultTree = tree[0]!;
        expect(defaultTree.characters).toHaveLength(2);
        expect(defaultTree.characters.reduce((total, item) => total + item.files.length, 0)).toBe(4); // 3 份迁移 + default/hero 原有 1 份
        const side = defaultTree.characters.find((item) => item.characterId === "side")!;
        const sideBytes = await readFile(path.join(root, ".nbook", "text-to-image", "character-groups", "default", "side", side.files[0]!.fileName));
        expect(sideBytes.equals(snapshot.sideBytes)).toBe(true);
    });
});

async function seedMergeFixture() {
    const root = await createRoot();
    const service = new CharacterVisualLibraryService();
    const late = await service.createGroup(root, {name: "后期"});
    const target = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "default 版"), {fileName: "Visual.JSON"});
    const conflicting = await service.write(root, {
        groupId: late.groupId,
        characterId: "hero",
        visualId: target.ref.visualId,
    }, makeVisual("hero", "后期一"), {allowCreate: true});
    const extra = await service.createNewVersion(root, {
        groupId: late.groupId,
        characterId: "hero",
        baseVisualId: conflicting.ref.visualId,
    }, makeVisual("hero", "后期二"));
    const side = await service.write(root, {groupId: late.groupId, characterId: "side"}, makeVisual("side", "配角"));
    await service.setEnabledGroups(root, [late.groupId]);

    const groupDirectory = path.join(root, ".nbook", "text-to-image", "character-groups");
    const snapshot = {
        tree: await service.listTree(root),
        groupsFile: await readFile(path.join(root, ".nbook", "text-to-image", "character-groups.json")),
        targetBytes: await readFile(path.join(groupDirectory, "default", "hero", "Visual.JSON")),
        conflictingBytes: await readFile(path.join(groupDirectory, late.groupId, "hero", conflicting.info.fileName)),
        extraBytes: await readFile(path.join(groupDirectory, late.groupId, "hero", extra.info.fileName)),
        sideBytes: await readFile(path.join(groupDirectory, late.groupId, "side", side.info.fileName)),
    };
    return {root, service, late, snapshot};
}

async function expectStateMatchesSnapshot(
    root: string,
    service: CharacterVisualLibraryService,
    snapshot: Awaited<ReturnType<typeof seedMergeFixture>>["snapshot"],
): Promise<void> {
    const groupDirectory = path.join(root, ".nbook", "text-to-image", "character-groups");
    const tree = await service.listTree(root);
    expect(tree).toEqual(snapshot.tree);
    expect(await readFile(path.join(root, ".nbook", "text-to-image", "character-groups.json"))).toEqual(snapshot.groupsFile);
    const late = tree.find((group) => group.groupId !== "default")!;
    const hero = late.characters.find((item) => item.characterId === "hero")!;
    const conflicting = hero.files.find((file) => file.fileName === "visual.json")!;
    expect((await readFile(path.join(groupDirectory, late.groupId, "hero", conflicting.fileName))).equals(snapshot.conflictingBytes)).toBe(true);
    expect((await readFile(path.join(groupDirectory, late.groupId, "hero", hero.files.find((file) => file.fileName !== "visual.json")!.fileName))).equals(snapshot.extraBytes)).toBe(true);
    expect((await readFile(path.join(groupDirectory, "default", "hero", "Visual.JSON"))).equals(snapshot.targetBytes)).toBe(true);
    const side = late.characters.find((item) => item.characterId === "side")!;
    expect((await readFile(path.join(groupDirectory, late.groupId, "side", side.files[0]!.fileName))).equals(snapshot.sideBytes)).toBe(true);
}

async function expectNoTransactionLeftovers(root: string): Promise<void> {
    const transactionRoot = path.join(root, ".nbook", "text-to-image", ".txn");
    let entries: string[] = [];
    try {
        entries = await import("node:fs/promises").then(({readdir}) => readdir(transactionRoot));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    expect(entries).toEqual([]);
}

async function createRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "nbook-character-migration-"));
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
