import fs from "node:fs/promises";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    migrateProjectTriggerWords,
    type TriggerWordsMigrationDependencies,
} from "nbook/server/text-to-image/trigger-words-migration";
import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import {
    TRIGGER_WORD_FORMAT_MARKER,
    TriggerWordFormatError,
} from "nbook/server/text-to-image/character-trigger-words";
import {writeCharacterVisual} from "nbook/server/text-to-image/character-visual.service";
import type {CharacterVisualFile} from "nbook/server/text-to-image/character-visual.codec";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
});

describe("触发词一次性迁移", () => {
    it("把英文逗号、中文逗号和混合逗号转换为 | 且不追加角色名", async () => {
        const root = await createRoot();
        await seedLegacyLibrary(root, [
            {groupId: "default", characterId: "elysia", triggerWords: "艾莉希雅, 爱莉，Elysia", cnName: "艾莉希雅"},
        ]);

        const stats = await migrateProjectTriggerWords(root);
        expect(stats).toMatchObject({scannedFiles: 1, convertedFiles: 1, unchangedFiles: 0, damagedFiles: 0});

        const raw = await readVisualRaw(root, "default", "elysia");
        expect(raw.character.triggerWords).toBe("艾莉希雅 | 爱莉 | Elysia");
        expect(raw.character.cnName).toBe("艾莉希雅");
        expect(raw.characterId).toBe("elysia");
    });

    it("二次运行不再改文件，格式标记保持", async () => {
        const root = await createRoot();
        await seedLegacyLibrary(root, [
            {groupId: "default", characterId: "elysia", triggerWords: "艾莉希雅 | 爱莉", cnName: "艾莉希雅"},
        ]);

        await migrateProjectTriggerWords(root);
        const before = await readVisualText(root, "default", "elysia");
        // 标记存在后二次运行直接短路，不再扫描或改文件。
        const stats = await migrateProjectTriggerWords(root);
        expect(stats).toMatchObject({convertedFiles: 0, unchangedFiles: 0, scannedFiles: 0});
        expect(await readVisualText(root, "default", "elysia")).toBe(before);
    });

    it("空触发词保持为空，损坏 JSON 保留并记入警告", async () => {
        const root = await createRoot();
        await seedLegacyLibrary(root, [
            {groupId: "default", characterId: "empty", triggerWords: "", cnName: "空"},
        ]);
        const brokenPath = path.join(root, ".nbook", "text-to-image", "character-groups", "default", "broken", "visual.json");
        await fs.mkdir(path.dirname(brokenPath), {recursive: true});
        await fs.writeFile(brokenPath, "{broken", "utf8");
        await fs.writeFile(path.join(root, ".nbook", "text-to-image", "character-groups", "default", "broken", "manifest.json"), JSON.stringify({
            schema: "nbook.character-visual-collection/v1",
            characterId: "broken",
            activeVisualId: "broken-visual",
            visuals: [{visualId: "broken-visual", fileName: "visual.json", createdAt: "2026-08-15T00:00:00.000Z", updatedAt: "2026-08-15T00:00:00.000Z", source: "manual"}],
        }), "utf8");

        const stats = await migrateProjectTriggerWords(root);
        expect(stats).toMatchObject({scannedFiles: 2, convertedFiles: 0, unchangedFiles: 1, damagedFiles: 1});
        expect(await fs.readFile(brokenPath, "utf8")).toBe("{broken");
        const empty = await readVisualRaw(root, "default", "empty");
        expect(empty.character.triggerWords).toBe("");
    });

    it("标记存在后不再扫描", async () => {
        const root = await createRoot();
        await seedLegacyLibrary(root, [
            {groupId: "default", characterId: "elysia", triggerWords: "艾莉希雅, 爱莉", cnName: "艾莉希雅"},
        ]);
        await migrateProjectTriggerWords(root);
        // 模拟手工重新引入逗号：标记存在时迁移器不再触碰。
        await overwriteTriggerWords(root, "default", "elysia", "艾莉希雅, 爱莉");
        const stats = await migrateProjectTriggerWords(root);
        expect(stats).toMatchObject({scannedFiles: 0});
        expect(stats.markerBefore).toBe(TRIGGER_WORD_FORMAT_MARKER);
    });

    it("写入失败时回滚全部已改文件和格式标记", async () => {
        const root = await createRoot();
        await seedLegacyLibrary(root, [
            {groupId: "default", characterId: "one", triggerWords: "一, 壹", cnName: "壹"},
            {groupId: "default", characterId: "two", triggerWords: "二, 贰", cnName: "贰"},
        ]);
        const groupsPath = path.join(root, ".nbook", "text-to-image", "character-groups.json");
        const groupsBefore = await fs.readFile(groupsPath, "utf8");

        const options: TriggerWordsMigrationDependencies = {failAt: "commit_marker"};
        await expect(migrateProjectTriggerWords(root, options)).rejects.toThrow("故障注入");

        expect(await fs.readFile(groupsPath, "utf8")).toBe(groupsBefore);
        expect((await readVisualRaw(root, "default", "one")).character.triggerWords).toBe("一, 壹");
        expect((await readVisualRaw(root, "default", "two")).character.triggerWords).toBe("二, 贰");
    });

    it("旧 visual 服务写入口拒绝逗号输入", async () => {
        const root = await createRoot();
        await expect(writeCharacterVisual(root, "elysia", makeVisual("elysia", "艾莉希雅, 爱莉")))
            .rejects.toBeInstanceOf(TriggerWordFormatError);
    });

    it("library.ensure 隐式触发迁移：标记缺失时读取前逗号数据已被规范化", async () => {
        const root = await createRoot();
        const service = new CharacterVisualLibraryService();
        await service.ensure(root);
        await service.write(root, {groupId: "default", characterId: "elysia"}, makeVisual("elysia", "艾莉希雅 | 爱莉"));
        // 模拟旧版本 Project：直接改回逗号并移除格式标记。
        await overwriteTriggerWords(root, "default", "elysia", "艾莉希雅, 爱莉");
        const groupsPath = path.join(root, ".nbook", "text-to-image", "character-groups.json");
        const groups = JSON.parse(await fs.readFile(groupsPath, "utf8")) as Record<string, unknown>;
        delete groups.triggerWordsFormat;
        await fs.writeFile(groupsPath, JSON.stringify(groups), "utf8");

        await service.listTree(root);
        expect((await readVisualRaw(root, "default", "elysia")).character.triggerWords).toBe("艾莉希雅 | 爱莉");
    });
});

type LegacySeed = {groupId: string; characterId: string; triggerWords: string; cnName: string};

/** 直接写原始库结构，绕过严格保存路径，用于制造待迁移的历史数据。 */
async function seedLegacyLibrary(root: string, seeds: LegacySeed[]): Promise<void> {
    const libraryRoot = path.join(root, ".nbook", "text-to-image");
    await fs.mkdir(libraryRoot, {recursive: true});
    await fs.writeFile(path.join(libraryRoot, "character-groups.json"), JSON.stringify({
        schema: "nbook.character-groups/v2",
        groups: [{groupId: "default", name: "默认分组", description: "", enabled: true, sortOrder: 0}],
    }), "utf8");
    for (const seed of seeds) {
        const directory = path.join(libraryRoot, "character-groups", seed.groupId, seed.characterId);
        await fs.mkdir(directory, {recursive: true});
        await fs.writeFile(path.join(directory, "visual.json"), JSON.stringify(makeVisual(seed.characterId, seed.triggerWords, seed.cnName)), "utf8");
        await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify({
            schema: "nbook.character-visual-collection/v1",
            characterId: seed.characterId,
            activeVisualId: `visual-${seed.characterId}`,
            visuals: [{
                visualId: `visual-${seed.characterId}`,
                fileName: "visual.json",
                createdAt: "2026-08-15T00:00:00.000Z",
                updatedAt: "2026-08-15T00:00:00.000Z",
                source: "manual",
            }],
        }), "utf8");
    }
}

async function readVisualRaw(root: string, groupId: string, characterId: string): Promise<CharacterVisualFile> {
    return JSON.parse(await readVisualText(root, groupId, characterId)) as CharacterVisualFile;
}

async function readVisualText(root: string, groupId: string, characterId: string): Promise<string> {
    return fs.readFile(path.join(root, ".nbook", "text-to-image", "character-groups", groupId, characterId, "visual.json"), "utf8");
}

async function overwriteTriggerWords(root: string, groupId: string, characterId: string, triggerWords: string): Promise<void> {
    const raw = await readVisualRaw(root, groupId, characterId);
    raw.character.triggerWords = triggerWords;
    await fs.writeFile(path.join(root, ".nbook", "text-to-image", "character-groups", groupId, characterId, "visual.json"), JSON.stringify(raw), "utf8");
}

async function createRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "nbook-trigger-migration-"));
    roots.push(root);
    return root;
}

function makeVisual(characterId: string, triggerWords: string, cnName = "艾莉希雅"): CharacterVisualFile {
    return {
        schema: "nbook.character-visual/v1",
        characterId,
        character: {cnName, enName: "Elysia", triggerWords},
        outfits: [],
        photos: [],
    };
}
