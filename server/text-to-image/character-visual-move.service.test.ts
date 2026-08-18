import fs from "node:fs/promises";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    commitVisualMove,
    previewVisualMove,
    recoverVisualMoveJournal,
    VisualMoveEquivalentConflictError,
    VisualMoveInvalidTargetError,
    VisualMoveRevisionConflictError,
    VisualMoveStaleSourceError,
    type VisualMoveDependencies,
} from "nbook/server/text-to-image/character-visual-move.service";
import {recoverUnfinishedTransactions} from "nbook/server/text-to-image/transaction-journal";
import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import type {CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
});

describe("视觉资料跨组移动", () => {
    it("来源最后一份视觉移动后来源角色节点消失，目标创建角色目录并设为生效", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        const written = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "traits"));

        const preview = await previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: written.ref.visualId,
            targetGroupId: late.groupId,
        });
        expect(preview).toMatchObject({
            sourceWillLoseCharacter: true,
            sourceNeedsActiveFallback: false,
            targetCharacterExists: false,
            equivalentTargetRef: null,
            equivalentTargetConflict: false,
        });

        const result = await commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: written.ref.visualId,
            expectedUpdatedAt: written.info.updatedAt,
            targetGroupId: late.groupId,
            expectedPreviewRevision: preview.revision,
        });
        expect(result.mode).toBe("moved");
        expect(result.sourceCharacterRemoved).toBe(true);
        expect(result.ref).toMatchObject({groupId: late.groupId, characterId: "hero", visualId: written.ref.visualId});

        expect((await service.listCharacters(root, "default")).map((item) => item.characterId)).toEqual([]);
        const targetCharacters = await service.listCharacters(root, late.groupId);
        expect(targetCharacters.map((item) => item.characterId)).toEqual(["hero"]);
        expect(targetCharacters[0]?.files[0]?.active).toBe(true);
        const moved = await service.read(root, {groupId: late.groupId, characterId: "hero"});
        expect(moved?.character.profileTraits).toBe("traits");
    });

    it("来源还有其它版本时只移除当前 visualId，fallback 生效项按 updatedAt/visualId 确定", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        const first = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "one"));
        const second = await service.createNewVersion(root, {groupId: "default", characterId: "hero", baseVisualId: first.ref.visualId}, makeVisual("hero", "two"));

        const preview = await previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: second.ref.visualId,
            targetGroupId: late.groupId,
        });
        expect(preview.sourceWillLoseCharacter).toBe(false);
        expect(preview.sourceNeedsActiveFallback).toBe(true);

        const result = await commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: second.ref.visualId,
            expectedUpdatedAt: second.info.updatedAt,
            targetGroupId: late.groupId,
            expectedPreviewRevision: preview.revision,
        });
        expect(result.sourceCharacterRemoved).toBe(false);

        const sourceFiles = await service.listVisualFiles(root, {groupId: "default", characterId: "hero"});
        expect(sourceFiles.map((file) => file.visualId)).toEqual([first.ref.visualId]);
        expect(sourceFiles[0]?.active).toBe(true);
        const remaining = await service.read(root, {groupId: "default", characterId: "hero"});
        expect(remaining?.character.profileTraits).toBe("one");
    });

    it("目标已有同角色时合并版本且不覆盖", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "early"));
        await service.write(root, {groupId: late.groupId, characterId: "hero"}, makeVisual("hero", "late-stage"));
        const source = await service.readWithInfo(root, {groupId: "default", characterId: "hero"});

        const preview = await previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: source!.info.visualId,
            targetGroupId: late.groupId,
        });
        expect(preview.targetCharacterExists).toBe(true);

        await commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: source!.info.visualId,
            expectedUpdatedAt: source!.info.updatedAt,
            targetGroupId: late.groupId,
            expectedPreviewRevision: preview.revision,
        });

        const files = await service.listVisualFiles(root, {groupId: late.groupId, characterId: "hero"});
        expect(files).toHaveLength(2);
        expect(new Set(files.map((file) => file.fileName)).size).toBe(files.length);
        expect(files.some((file) => file.visualId === source!.info.visualId)).toBe(true);
        // 移动的视觉成为目标组当前生效版本。
        expect(files.find((file) => file.visualId === source!.info.visualId)?.active).toBe(true);
        const lateStage = await service.read(root, {groupId: late.groupId, characterId: "hero", visualId: files.find((file) => file.visualId !== source!.info.visualId)!.visualId});
        expect(lateStage?.character.profileTraits).toBe("late-stage");
    });

    it("目标存在等价内容时复用目标 ref，不生成第三份，来源不保留", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "same"));
        const target = await service.write(root, {groupId: late.groupId, characterId: "hero"}, makeVisual("hero", "same"));
        const source = await service.readWithInfo(root, {groupId: "default", characterId: "hero"});

        const preview = await previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: source!.info.visualId,
            targetGroupId: late.groupId,
        });
        expect(preview.equivalentTargetRef).toMatchObject({groupId: late.groupId, visualId: target.ref.visualId});

        const result = await commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: source!.info.visualId,
            expectedUpdatedAt: source!.info.updatedAt,
            targetGroupId: late.groupId,
            expectedPreviewRevision: preview.revision,
        });
        expect(result.mode).toBe("merged-equivalent");
        expect(result.ref.visualId).toBe(target.ref.visualId);

        expect(await service.listCharacters(root, "default")).toEqual([]);
        const files = await service.listVisualFiles(root, {groupId: late.groupId, characterId: "hero"});
        expect(files).toHaveLength(1);
    });

    it("多个等价目标时预检报冲突", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "same"));
        const first = await service.write(root, {groupId: late.groupId, characterId: "hero"}, makeVisual("hero", "same"));
        await service.createNewVersion(root, {groupId: late.groupId, characterId: "hero", baseVisualId: first.ref.visualId}, makeVisual("hero", "same"));
        const source = await service.readWithInfo(root, {groupId: "default", characterId: "hero"});

        const preview = await previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: source!.info.visualId,
            targetGroupId: late.groupId,
        });
        expect(preview.equivalentTargetConflict).toBe(true);
        await expect(commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: source!.info.visualId,
            expectedUpdatedAt: source!.info.updatedAt,
            targetGroupId: late.groupId,
            expectedPreviewRevision: preview.revision,
        })).rejects.toBeInstanceOf(VisualMoveEquivalentConflictError);
    });

    it("文件名与 visualId 冲突时安全改名/换新 ID 并同步更新受管引用", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "moved"));
        const source = await service.readWithInfo(root, {groupId: "default", characterId: "hero"});
        const visualId = source!.info.visualId;
        // 目标组预置同名 visual.json 文件与同 visualId 的另一个版本（内容不同）。
        const targetDirectory = path.join(root, ".nbook", "text-to-image", "character-groups", late.groupId, "hero");
        await fs.mkdir(targetDirectory, {recursive: true});
        await fs.writeFile(path.join(targetDirectory, "visual.json"), JSON.stringify(makeVisual("hero", "existing", visualId)), "utf8");
        await fs.writeFile(path.join(targetDirectory, "manifest.json"), JSON.stringify({
            schema: "nbook.character-visual-collection/v1",
            characterId: "hero",
            activeVisualId: visualId,
            visuals: [{visualId, fileName: "visual.json", createdAt: "2026-08-15T00:00:00.000Z", updatedAt: "2026-08-15T00:00:00.000Z", source: "manual"}],
        }), "utf8");
        // 预置发送数据引用来源 ref。
        const sendDataPath = path.join(root, ".nbook", "text-to-image-send-data.json");
        await fs.writeFile(sendDataPath, JSON.stringify({
            lorebookPaths: [],
            characterIds: ["hero"],
            characterSelections: [{characterId: "hero", groupId: "default", visualId}],
            outfitSelections: [{characterId: "hero", groupId: "default", visualId, name: "校服"}],
        }), "utf8");

        const preview = await previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: visualId,
            targetGroupId: late.groupId,
        });
        expect(preview.fileNameConflict).toBe(true);
        expect(preview.visualIdConflict).toBe(true);
        expect(preview.managedReferenceCount).toBe(2);

        const result = await commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: visualId,
            expectedUpdatedAt: source!.info.updatedAt,
            targetGroupId: late.groupId,
            expectedPreviewRevision: preview.revision,
        });
        expect(result.ref.visualId).not.toBe(visualId);
        expect(result.info.fileName).not.toBe("visual.json");

        const sendData = JSON.parse(await fs.readFile(sendDataPath, "utf8")) as {
            characterIds: string[];
            characterSelections: Array<{characterId: string; groupId: string; visualId: string}>;
            outfitSelections: Array<{characterId: string; groupId: string; visualId: string; name: string}>;
        };
        expect(sendData.characterSelections).toEqual([{characterId: "hero", groupId: late.groupId, visualId: result.ref.visualId}]);
        expect(sendData.outfitSelections).toEqual([{characterId: "hero", groupId: late.groupId, visualId: result.ref.visualId, name: "校服"}]);
        expect(sendData.characterIds).toEqual(["hero"]);
    });

    it("照片保持原路径且不被删除；移动后目标 JSON 仍可读取照片", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        const photoRelative = "assets/tti/hero.png";
        const photoPath = path.join(root, photoRelative);
        await fs.mkdir(path.dirname(photoPath), {recursive: true});
        await fs.writeFile(photoPath, Buffer.from("image"));
        const visual = makeVisual("hero", "traits");
        visual.photos = [photoRelative];
        const written = await service.write(root, {groupId: "default", characterId: "hero"}, visual);

        const preview = await previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: written.ref.visualId,
            targetGroupId: late.groupId,
        });
        await commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: written.ref.visualId,
            expectedUpdatedAt: written.info.updatedAt,
            targetGroupId: late.groupId,
            expectedPreviewRevision: preview.revision,
        });

        expect(await fs.readFile(photoPath, "utf8")).toBe("image");
        const moved = await service.read(root, {groupId: late.groupId, characterId: "hero"});
        expect(moved?.photos).toEqual([photoRelative]);
    });

    it("来源与目标相同、目标分组不存在、来源过期和预检过期均拒绝", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        const written = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero"));

        await expect(previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: written.ref.visualId,
            targetGroupId: "default",
        })).rejects.toBeInstanceOf(VisualMoveInvalidTargetError);
        await expect(previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: written.ref.visualId,
            targetGroupId: "missing",
        })).rejects.toBeInstanceOf(VisualMoveInvalidTargetError);

        const preview = await previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: written.ref.visualId,
            targetGroupId: late.groupId,
        });
        await expect(commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: written.ref.visualId,
            expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
            targetGroupId: late.groupId,
            expectedPreviewRevision: preview.revision,
        })).rejects.toBeInstanceOf(VisualMoveStaleSourceError);
        await expect(commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: written.ref.visualId,
            expectedUpdatedAt: written.info.updatedAt,
            targetGroupId: late.groupId,
            expectedPreviewRevision: "stale-revision",
        })).rejects.toBeInstanceOf(VisualMoveRevisionConflictError);
        // 全部拒绝后状态不变。
        expect((await service.listCharacters(root, "default")).map((item) => item.characterId)).toEqual(["hero"]);
    });

    it.each(["backup", "commit_files", "commit_refs", "verify"] as const)(
        "故障注入 %s 后完整回滚，不丢文件也不留下双份真相源",
        async (failAt) => {
            const root = await createRoot();
            const service = new CharacterVisualLibraryService();
            const late = await service.createGroup(root, {name: "后期"});
            await service.write(root, {groupId: late.groupId, characterId: "hero"}, makeVisual("hero", "target"));
            const written = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "source"));
            const preview = await previewVisualMove(root, {
                sourceGroupId: "default",
                sourceCharacterId: "hero",
                sourceVisualId: written.ref.visualId,
                targetGroupId: late.groupId,
            });
            const options: VisualMoveDependencies = {failAt};

            await expect(commitVisualMove(root, {
                sourceGroupId: "default",
                sourceCharacterId: "hero",
                sourceVisualId: written.ref.visualId,
                expectedUpdatedAt: written.info.updatedAt,
                targetGroupId: late.groupId,
                expectedPreviewRevision: preview.revision,
            }, options)).rejects.toThrow("故障注入");

            const defaultFiles = await service.listVisualFiles(root, {groupId: "default", characterId: "hero"});
            const lateFiles = await service.listVisualFiles(root, {groupId: late.groupId, characterId: "hero"});
            expect(defaultFiles.map((file) => file.visualId)).toEqual([written.ref.visualId]);
            expect(lateFiles).toHaveLength(1);
            const moved = await service.read(root, {groupId: "default", characterId: "hero"});
            expect(moved?.character.profileTraits).toBe("source");
        },
    );

    it("重启后能恢复未完成事务", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        const written = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "source"));
        const preview = await previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: written.ref.visualId,
            targetGroupId: late.groupId,
        });
        // 模拟进程中断：crash 注入跳过回滚，留下日志与备份，由下一次库操作恢复。
        await expect(commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: written.ref.visualId,
            expectedUpdatedAt: written.info.updatedAt,
            targetGroupId: late.groupId,
            expectedPreviewRevision: preview.revision,
        }, {failAt: "crash"})).rejects.toThrow("模拟进程中断");

        await recoverUnfinishedTransactions(
            root,
            {"visual-move-v1": recoverVisualMoveJournal},
            {activeWindowMs: 0},
        );
        const defaultFiles = await service.listVisualFiles(root, {groupId: "default", characterId: "hero"});
        expect(defaultFiles.map((file) => file.visualId)).toEqual([written.ref.visualId]);
        expect(await service.listCharacters(root, late.groupId)).toEqual([]);
        const transactionEntries = await fs.readdir(path.join(root, ".nbook", "text-to-image", ".txn")).catch(() => []);
        expect(transactionEntries).toEqual([]);
    });

    it("等价合并会把目标 manifest 的生效项切换为被复用的等价视觉", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        const source = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "same"));
        const activeOther = await service.write(root, {groupId: late.groupId, characterId: "hero"}, makeVisual("hero", "other"));
        const equivalent = await service.createNewVersion(root, {groupId: late.groupId, characterId: "hero", baseVisualId: activeOther.ref.visualId}, makeVisual("hero", "same"));
        // 目标当前生效的是另一份内容；等价视觉存在但未生效。
        await service.setActiveVisual(root, {groupId: late.groupId, characterId: "hero", visualId: activeOther.ref.visualId});

        const preview = await previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: source.ref.visualId,
            targetGroupId: late.groupId,
        });
        expect(preview.equivalentTargetRef?.visualId).toBe(equivalent.ref.visualId);

        const result = await commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: source.ref.visualId,
            expectedUpdatedAt: source.info.updatedAt,
            targetGroupId: late.groupId,
            expectedPreviewRevision: preview.revision,
        });
        expect(result.mode).toBe("merged-equivalent");
        const files = await service.listVisualFiles(root, {groupId: late.groupId, characterId: "hero"});
        expect(files.find((file) => file.visualId === equivalent.ref.visualId)?.active).toBe(true);
        expect(files.find((file) => file.visualId === activeOther.ref.visualId)?.active).toBe(false);
    });

    it("多版本来源移动后删除精确来源 JSON；故障回滚恢复同字节文件", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        const late = await service.createGroup(root, {name: "后期"});
        const first = await service.write(root, {groupId: "default", characterId: "hero"}, makeVisual("hero", "first"));
        const moved = await service.createNewVersion(root, {groupId: "default", characterId: "hero", baseVisualId: first.ref.visualId}, makeVisual("hero", "second"));
        const sourceDirectory = path.join(root, ".nbook", "text-to-image", "character-groups", "default", "hero");
        const movedFileName = moved.info.fileName;
        const originalBytes = await fs.readFile(path.join(sourceDirectory, movedFileName));

        const preview = await previewVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: moved.ref.visualId,
            targetGroupId: late.groupId,
        });
        await expect(commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: moved.ref.visualId,
            expectedUpdatedAt: moved.info.updatedAt,
            targetGroupId: late.groupId,
            expectedPreviewRevision: preview.revision,
        }, {failAt: "verify"})).rejects.toThrow("故障注入");
        await expect(fs.readFile(path.join(sourceDirectory, movedFileName))).resolves.toEqual(originalBytes);

        await commitVisualMove(root, {
            sourceGroupId: "default",
            sourceCharacterId: "hero",
            sourceVisualId: moved.ref.visualId,
            expectedUpdatedAt: moved.info.updatedAt,
            targetGroupId: late.groupId,
            expectedPreviewRevision: preview.revision,
        });
        const names = await fs.readdir(sourceDirectory);
        expect(names).not.toContain(movedFileName);
        expect(names).toContain(first.info.fileName);
    });
});

async function createRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "nbook-visual-move-"));
    roots.push(root);
    return root;
}

function makeVisual(characterId: string, profileTraits: string, visualId?: string): CharacterVisualFile {
    return {
        schema: "nbook.character-visual/v1",
        ...(visualId ? {visualId} : {}),
        characterId,
        character: {cnName: characterId, enName: characterId, triggerWords: characterId, profileTraits},
        outfits: [],
        photos: [],
    };
}
