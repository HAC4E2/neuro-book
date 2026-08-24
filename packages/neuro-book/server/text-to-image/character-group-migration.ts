import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    parseCharacterVisualJson,
    renderCharacterVisualJson,
} from "nbook/server/text-to-image/character-visual.codec";
import {
    buildTransactionEnvelope,
    newTransactionId,
    removeTransactionJournal,
    transactionJournalRoot,
    VISUAL_LIBRARY_DIRECTORY,
    withVisualLibraryProjectLock,
    writeJsonAtomic,
    writeTransactionJournal,
    type TransactionJournalEnvelope,
} from "nbook/server/text-to-image/transaction-journal";

const LIBRARY_DIRECTORY = VISUAL_LIBRARY_DIRECTORY;
const GROUPS_FILE = "character-groups.json";
const GROUP_DIRECTORY = "character-groups";
const MANIFEST_FILE = "manifest.json";
const TRANSACTION_DIRECTORY = ".txn";
const SEND_DATA_FILE = "text-to-image-send-data.json";
const JOURNAL_KIND = "group-migration-v1";

export type GroupMigrationGroupsFile = {
    schema: "nbook.character-groups/v2";
    groups: Array<{
        groupId: string;
        name: string;
        description: string;
        enabled: boolean;
        sortOrder: number;
    }>;
};

export type GroupMigrationManifest = {
    schema: "nbook.character-visual-collection/v1";
    characterId: string;
    activeVisualId: string | null;
    visuals: Array<{
        visualId: string;
        fileName: string;
        createdAt: string;
        updatedAt: string;
        source: "manual" | "llm" | "migration" | "copy";
    }>;
};

export type GroupMigrationRef = {
    groupId: string;
    characterId: string;
    visualId: string;
};

export type GroupMigrationRefMapping = {
    old: GroupMigrationRef;
    next: GroupMigrationRef;
};

export type GroupMigrationFilePlan = {
    visualId: string;
    sourceFileName: string;
    targetFileName: string;
    nextVisualId: string;
    fileNameRenamed: boolean;
    visualIdChanged: boolean;
    invalid: boolean;
    bytes: number;
    contentHash: string;
};

export type GroupMigrationCharacterPlan = {
    characterId: string;
    targetExists: boolean;
    targetManifest: GroupMigrationManifest | null;
    sourceManifest: GroupMigrationManifest | null;
    files: GroupMigrationFilePlan[];
    mergedActiveVisualId: string | null;
};

export type GroupMigrationPlan = {
    groupId: string;
    revision: string;
    characters: GroupMigrationCharacterPlan[];
    rawDirectories: string[];
    refMap: GroupMigrationRefMapping[];
    stats: {
        characterCount: number;
        visualCount: number;
        invalidFileCount: number;
        fileNameConflictCount: number;
        visualIdConflictCount: number;
        managedReferenceCount: number;
        defaultEnabled: boolean;
    };
};

export type GroupMigrationDependencies = {
    /** 测试注入：在指定阶段抛出异常，验证回滚与恢复。 */
    failAt?: "stage" | "verify" | "backup" | "commit_files" | "commit_groups" | "commit_refs" | "remove_source";
    /** 测试注入：锁等待超时毫秒，默认 15s。 */
    lockTimeoutMs?: number;
};

export class GroupMigrationRevisionConflictError extends Error {
    readonly code = "TEXT_TO_IMAGE_GROUP_MIGRATION_REVISION_CONFLICT";

    constructor(readonly groupId: string) {
        super(`分组“${groupId}”在预检后发生了变化，请重新查看影响摘要后再确认删除。`);
        this.name = "GroupMigrationRevisionConflictError";
    }
}

type GroupMigrationJournalPayload = {
    groupId: string;
    sourceGroupDirectory: string;
    /** 已 rename 进备份的 default 目录名，回滚时原路恢复。 */
    backedUpDefaultDirectories: string[];
    /** 合并构建的 default 目录名，回滚时直接删除。 */
    builtTargetDirectories: string[];
    /** 整目录移入 default 的角色/目录名，回滚时先移回来源备份再恢复 default。 */
    movedWholeDirectories: string[];
    /** 已从来源组 rename 进备份的目录名，回滚时移回来源组。 */
    movedSourceEntries: string[];
    groupsBackedUp: boolean;
    sendDataBackedUp: boolean;
};

type GroupMigrationJournalState =
    | "preparing" | "backed-up" | "files-committed" | "groups-committed" | "refs-committed" | "source-removed" | "committed";

export function groupMigrationTransactionRoot(projectRoot: string): string {
    return transactionJournalRoot(projectRoot);
}

export function groupDirectoryForMigration(projectRoot: string, groupId: string): string {
    return path.join(projectRoot, LIBRARY_DIRECTORY, GROUP_DIRECTORY, groupId);
}

export function defaultGroupDirectoryForMigration(projectRoot: string): string {
    return path.join(projectRoot, LIBRARY_DIRECTORY, GROUP_DIRECTORY, "default");
}

function sendDataPath(projectRoot: string): string {
    return path.join(projectRoot, ".nbook", SEND_DATA_FILE);
}

/**
 * 计算分组删除迁移的确定性计划。只读，不修改任何文件。
 * revision 覆盖迁移依赖的全部状态：来源组 manifest 与文件哈希、default manifest、
 * 分组清单和受管引用，任何变化都会让旧确认在提交时返回 409。
 */
export async function buildGroupMigrationPlan(
    projectRoot: string,
    groupId: string,
    groups: GroupMigrationGroupsFile,
    options: {sendData?: unknown},
): Promise<GroupMigrationPlan> {
    const sourceDirectory = groupDirectoryForMigration(projectRoot, groupId);
    const defaultDirectory = defaultGroupDirectoryForMigration(projectRoot);
    const characters: GroupMigrationCharacterPlan[] = [];
    const rawDirectories: string[] = [];
    const refMap: GroupMigrationRefMapping[] = [];

    for (const entry of await readDirectoryEntries(sourceDirectory)) {
        if (!entry.isDirectory()) continue;
        const characterId = entry.name;
        const sourceManifest = await readMigrationManifest(path.join(sourceDirectory, characterId), characterId);
        const targetExists = await pathExists(path.join(defaultDirectory, characterId));
        const targetManifest = await readMigrationManifest(path.join(defaultDirectory, characterId), characterId);
        if (!sourceManifest || sourceManifest.visuals.length === 0) {
            // 没有可解析 manifest 的目录按原始目录整体迁移，避免留下孤儿数据。
            rawDirectories.push(characterId);
            continue;
        }
        const occupiedFileNames = new Set<string>();
        const occupiedVisualIds = new Set<string>();
        if (targetExists) {
            for (const visual of targetManifest?.visuals ?? []) {
                occupiedFileNames.add(visual.fileName.toLocaleLowerCase());
                occupiedVisualIds.add(visual.visualId);
            }
            for (const file of await readDirectoryEntries(path.join(defaultDirectory, characterId))) {
                if (file.isFile()) occupiedFileNames.add(file.name.toLocaleLowerCase());
            }
        }
        const files: GroupMigrationFilePlan[] = [];
        for (const visual of sourceManifest.visuals) {
            const sourcePath = path.join(sourceDirectory, characterId, visual.fileName);
            const raw = await readBytesAllowMissing(sourcePath);
            const bytes = raw.length;
            const contentHash = hashBytes(raw);
            let invalid = false;
            try {
                if (raw.length === 0) throw new Error("空文件");
                parseCharacterVisualJson(new TextDecoder().decode(raw));
            } catch {
                invalid = true;
            }
            // 冲突解由状态内容确定性推导，保证预检与提交两次计划完全一致。
            const nextVisualId = occupiedVisualIds.has(visual.visualId)
                ? deterministicUuid(`${characterId}\u0000${visual.visualId}`)
                : visual.visualId;
            let targetFileName = visual.fileName;
            let fileNameRenamed = false;
            if (occupiedFileNames.has(visual.fileName.toLocaleLowerCase())) {
                targetFileName = allocateMovedFileName(visual.fileName, occupiedFileNames, `${characterId}\u0000${visual.visualId}`);
                fileNameRenamed = true;
            }
            occupiedFileNames.add(targetFileName.toLocaleLowerCase());
            occupiedVisualIds.add(nextVisualId);
            files.push({
                visualId: visual.visualId,
                sourceFileName: visual.fileName,
                targetFileName,
                nextVisualId,
                fileNameRenamed,
                visualIdChanged: nextVisualId !== visual.visualId,
                invalid,
                bytes,
                contentHash,
            });
            refMap.push({
                old: {groupId, characterId, visualId: visual.visualId},
                next: {groupId: "default", characterId, visualId: nextVisualId},
            });
        }
        characters.push({
            characterId,
            targetExists,
            targetManifest,
            sourceManifest,
            files,
            mergedActiveVisualId: resolveMergedActiveVisualId(targetExists, targetManifest, sourceManifest, files),
        });
    }
    characters.sort((left, right) => left.characterId.localeCompare(right.characterId));
    rawDirectories.sort((left, right) => left.localeCompare(right));

    const stats = {
        characterCount: characters.length,
        visualCount: characters.reduce((total, character) => total + character.files.length, 0),
        invalidFileCount: characters.reduce((total, character) => total + character.files.filter((file) => file.invalid).length, 0),
        fileNameConflictCount: characters.reduce((total, character) => total + character.files.filter((file) => file.fileNameRenamed).length, 0),
        visualIdConflictCount: characters.reduce((total, character) => total + character.files.filter((file) => file.visualIdChanged).length, 0),
        managedReferenceCount: countManagedReferences(options.sendData, groupId),
        defaultEnabled: groups.groups.find((group) => group.groupId === "default")?.enabled ?? false,
    };
    const revision = createHash("sha256").update(JSON.stringify({
        groupId,
        characters: characters.map((character) => ({
            characterId: character.characterId,
            targetExists: character.targetExists,
            targetManifest: character.targetManifest,
            sourceManifest: character.sourceManifest,
            files: character.files.map((file) => ({...file, invalid: undefined, bytes: undefined})),
        })),
        rawDirectories,
        default: await collectDefaultState(defaultDirectory),
        groups,
        sendData: options.sendData ?? null,
    })).digest("hex");
    return {groupId, revision, characters, rawDirectories, refMap, stats};
}

function resolveMergedActiveVisualId(
    targetExists: boolean,
    targetManifest: GroupMigrationManifest | null,
    sourceManifest: GroupMigrationManifest,
    files: GroupMigrationFilePlan[],
): string | null {
    const targetIds = new Set(targetManifest?.visuals.map((visual) => visual.visualId) ?? []);
    if (targetExists && targetManifest?.activeVisualId && targetIds.has(targetManifest.activeVisualId)) {
        return targetManifest.activeVisualId;
    }
    if (sourceManifest.activeVisualId) {
        const mapped = files.find((file) => file.visualId === sourceManifest.activeVisualId);
        if (mapped) return mapped.nextVisualId;
    }
    return null;
}

function countManagedReferences(sendData: unknown, groupId: string): number {
    if (typeof sendData !== "object" || sendData === null) return 0;
    const record = sendData as Record<string, unknown>;
    const count = (list: unknown): number => (Array.isArray(list) ? list.filter((item) => (
        typeof item === "object" && item !== null
        && "groupId" in item && (item as Record<string, unknown>).groupId === groupId
    )).length : 0);
    return count(record.characterSelections) + count(record.outfitSelections);
}

/**
 * 在受控事务目录中执行迁移提交：先全部备份，再逐层提交，任一步失败按日志回滚。
 * 来源组目录只在目标、分组清单和受管引用全部生效后才删除；备份保留到成功收尾。
 */
export async function commitGroupMigration(
    projectRoot: string,
    plan: GroupMigrationPlan,
    options: GroupMigrationDependencies = {},
): Promise<void> {
    const transactionId = newTransactionId();
    const transactionRoot = groupMigrationTransactionRoot(projectRoot);
    await fs.mkdir(transactionRoot, {recursive: true});
    const transactionDirectory = path.join(transactionRoot, transactionId);
    const backupDirectory = path.join(transactionDirectory, "backup");
    const sourceDirectory = groupDirectoryForMigration(projectRoot, plan.groupId);
    const defaultDirectory = defaultGroupDirectoryForMigration(projectRoot);
    const log: GroupMigrationJournalPayload = {
        groupId: plan.groupId,
        sourceGroupDirectory: sourceDirectory,
        backedUpDefaultDirectories: [],
        builtTargetDirectories: [],
        movedWholeDirectories: [],
        movedSourceEntries: [],
        groupsBackedUp: false,
        sendDataBackedUp: false,
    };
    let logState: GroupMigrationJournalState = "preparing";
    const writeLog = (state: GroupMigrationJournalState): Promise<void> => {
        logState = state;
        return writeMigrationLog(projectRoot, transactionId, state, log);
    };

    try {
        await fs.mkdir(backupDirectory, {recursive: true});
        await writeLog("preparing");
        await injectFailure(options.failAt, "stage");

        // 1. 备份：default 受影响目录与来源组全部目录先 rename 进事务目录。
        const defaultBackupDirectory = path.join(backupDirectory, "default");
        const sourceBackupDirectory = path.join(backupDirectory, "source");
        await fs.mkdir(defaultBackupDirectory, {recursive: true});
        await fs.mkdir(sourceBackupDirectory, {recursive: true});
        for (const character of plan.characters) {
            if (!character.targetExists) continue;
            await renameAllowMissing(path.join(defaultDirectory, character.characterId), path.join(defaultBackupDirectory, character.characterId));
            log.backedUpDefaultDirectories.push(character.characterId);
        }
        for (const rawDirectory of plan.rawDirectories) {
            if (!await pathExists(path.join(defaultDirectory, rawDirectory))) continue;
            await renameAllowMissing(path.join(defaultDirectory, rawDirectory), path.join(defaultBackupDirectory, rawDirectory));
            log.backedUpDefaultDirectories.push(rawDirectory);
        }
        for (const name of [...plan.characters.map((character) => character.characterId), ...plan.rawDirectories]) {
            await renameAllowMissing(path.join(sourceDirectory, name), path.join(sourceBackupDirectory, name));
            log.movedSourceEntries.push(name);
        }
        const groupsPath = path.join(projectRoot, LIBRARY_DIRECTORY, GROUPS_FILE);
        await fs.copyFile(groupsPath, path.join(backupDirectory, GROUPS_FILE));
        log.groupsBackedUp = true;
        const managedPath = sendDataPath(projectRoot);
        if (await pathExists(managedPath)) {
            await fs.copyFile(managedPath, path.join(backupDirectory, SEND_DATA_FILE));
            log.sendDataBackedUp = true;
        }
        await writeLog("backed-up");
        await injectFailure(options.failAt, "backup");

        // 2. 提交文件：目标不存在的角色整目录 rename，其余合并后写新 manifest。
        // default 分组目录在从未写入角色时并不存在，先确保父目录存在。
        await fs.mkdir(defaultDirectory, {recursive: true});
        for (const character of plan.characters) {
            if (!character.targetExists) {
                await fs.rename(
                    path.join(sourceBackupDirectory, character.characterId),
                    path.join(defaultDirectory, character.characterId),
                );
                log.movedWholeDirectories.push(character.characterId);
                continue;
            }
            await buildMergedCharacterDirectory(defaultDirectory, defaultBackupDirectory, sourceBackupDirectory, character);
            log.builtTargetDirectories.push(character.characterId);
        }
        for (const rawDirectory of plan.rawDirectories) {
            if (await pathExists(path.join(defaultDirectory, rawDirectory))) {
                await buildRawDirectory(defaultDirectory, defaultBackupDirectory, sourceBackupDirectory, rawDirectory);
                log.builtTargetDirectories.push(rawDirectory);
            } else {
                await fs.rename(
                    path.join(sourceBackupDirectory, rawDirectory),
                    path.join(defaultDirectory, rawDirectory),
                );
                log.movedWholeDirectories.push(rawDirectory);
            }
        }
        await verifyMigrationCounts(projectRoot, plan);
        await injectFailure(options.failAt, "verify");
        await writeLog("files-committed");
        await injectFailure(options.failAt, "commit_files");

        // 3. 分组清单：移除来源组；删除已启用来源组时只移除来源 ID，不隐式启用 default。
        const groups = await readMigrationGroups(projectRoot);
        const migrated = groups.groups.filter((group) => group.groupId !== plan.groupId);
        await writeJsonAtomic(path.join(projectRoot, LIBRARY_DIRECTORY, GROUPS_FILE), {...groups, groups: migrated});
        await writeLog("groups-committed");
        await injectFailure(options.failAt, "commit_groups");

        // 4. 受管引用：send-data 中指向来源组的固定 groupId/visualId 引用按 ref 映射更新。
        await migrateManagedReferences(projectRoot, plan);
        await writeLog("refs-committed");
        await injectFailure(options.failAt, "commit_refs");

        // 5. 全部生效后才移除来源分组目录。
        await fs.rm(sourceDirectory, {recursive: true, force: true});
        await writeLog("source-removed");
        await injectFailure(options.failAt, "remove_source");

        // 6. 成功收尾：清理事务目录与日志。
        await writeLog("committed");
        await fs.rm(transactionDirectory, {recursive: true, force: true});
        await removeTransactionJournal(projectRoot, transactionId);
    } catch (error) {
        try {
            await rollbackGroupMigration(projectRoot, log, transactionDirectory, transactionId);
        } catch (rollbackCause) {
            throw new Error(`分组删除迁移失败且回滚未完成：${errorMessage(error)}；回滚错误：${errorMessage(rollbackCause)}`);
        }
        throw error;
    }
}

/** 合并构建 default 目标目录：备份目录保持完整，全部通过复制进入目标，便于回滚。 */
async function buildMergedCharacterDirectory(
    defaultDirectory: string,
    defaultBackupDirectory: string,
    sourceBackupDirectory: string,
    character: GroupMigrationCharacterPlan,
): Promise<void> {
    const targetDirectory = path.join(defaultDirectory, character.characterId);
    const backupPath = path.join(defaultBackupDirectory, character.characterId);
    const sourcePath = path.join(sourceBackupDirectory, character.characterId);
    await fs.mkdir(targetDirectory, {recursive: true});
    await copyDirectoryContents(backupPath, targetDirectory, {skipManifest: true});
    for (const file of character.files) {
        const raw = await readBytesAllowMissing(path.join(sourcePath, file.sourceFileName));
        if (file.visualIdChanged && !file.invalid) {
            // 视觉 ID 冲突时内容中的 visualId 同步改写；其他字段不变。
            const parsed = parseCharacterVisualJson(new TextDecoder().decode(raw));
            const rewritten = renderCharacterVisualJson({...parsed, visualId: file.nextVisualId});
            await fs.writeFile(path.join(targetDirectory, file.targetFileName), rewritten, "utf8");
        } else {
            // 损坏 JSON 按原始字节迁移，继续作为错误节点可见。
            await fs.writeFile(path.join(targetDirectory, file.targetFileName), raw);
        }
    }
    if (character.sourceManifest) {
        await writeJsonAtomic(path.join(targetDirectory, MANIFEST_FILE), mergeManifests(character));
    }
}

async function buildRawDirectory(
    defaultDirectory: string,
    defaultBackupDirectory: string,
    sourceBackupDirectory: string,
    name: string,
): Promise<void> {
    const targetDirectory = path.join(defaultDirectory, name);
    await fs.mkdir(targetDirectory, {recursive: true});
    await copyDirectoryContents(path.join(defaultBackupDirectory, name), targetDirectory, {skipManifest: false});
    await copyDirectoryContents(path.join(sourceBackupDirectory, name), targetDirectory, {skipManifest: false});
}

function mergeManifests(character: GroupMigrationCharacterPlan): GroupMigrationManifest {
    const merged: GroupMigrationManifest = {
        schema: "nbook.character-visual-collection/v1",
        characterId: character.characterId,
        activeVisualId: character.mergedActiveVisualId,
        visuals: [],
    };
    const seen = new Set<string>();
    for (const visual of character.targetManifest?.visuals ?? []) {
        merged.visuals.push({...visual});
        seen.add(visual.visualId);
    }
    for (const file of character.files) {
        if (seen.has(file.nextVisualId)) continue;
        const source = character.sourceManifest?.visuals.find((visual) => visual.visualId === file.visualId);
        merged.visuals.push({
            visualId: file.nextVisualId,
            fileName: file.targetFileName,
            createdAt: source?.createdAt ?? new Date().toISOString(),
            updatedAt: source?.updatedAt ?? new Date().toISOString(),
            source: source?.source ?? "migration",
        });
        seen.add(file.nextVisualId);
    }
    return merged;
}

async function copyDirectoryContents(
    sourceDirectory: string,
    targetDirectory: string,
    options: {skipManifest: boolean},
): Promise<void> {
    await fs.mkdir(targetDirectory, {recursive: true});
    for (const entry of await readDirectoryEntries(sourceDirectory)) {
        if (!entry.isFile()) {
            // 目录整体复制，避免丢数据。
            await fs.cp(path.join(sourceDirectory, entry.name), path.join(targetDirectory, entry.name), {recursive: true});
            continue;
        }
        if (options.skipManifest && entry.name === MANIFEST_FILE) {
            // 旧 manifest 由合并后的新 manifest 取代。
            continue;
        }
        const target = await allocateRawTargetName(targetDirectory, entry.name);
        await fs.copyFile(path.join(sourceDirectory, entry.name), target);
    }
}

async function allocateRawTargetName(targetDirectory: string, fileName: string): Promise<string> {
    const direct = path.join(targetDirectory, fileName);
    if (!await pathExistsCaseInsensitive(targetDirectory, fileName)) return direct;
    const lowered = fileName.toLocaleLowerCase();
    const base = lowered.endsWith(".json") ? fileName.slice(0, -5) : fileName;
    const extension = lowered.endsWith(".json") ? ".json" : "";
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const candidate = `${base}-moved-${deterministicSuffix(`${targetDirectory} ${fileName} ${attempt}`)}${extension}`;
        if (!await pathExistsCaseInsensitive(targetDirectory, candidate)) {
            return path.join(targetDirectory, candidate);
        }
    }
    throw new Error(`无法为文件“${fileName}”分配不冲突的目标名`);
}

function allocateMovedFileName(fileName: string, occupied: Set<string>, seed: string): string {
    const lowered = fileName.toLocaleLowerCase();
    const base = lowered.endsWith(".json") ? fileName.slice(0, -5) : fileName;
    const extension = lowered.endsWith(".json") ? ".json" : "";
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const suffix = deterministicSuffix(`${seed}\u0000${fileName}\u0000${attempt}`);
        const candidate = `${base}-moved-${suffix}${extension}`;
        if (!occupied.has(candidate.toLocaleLowerCase())) {
            occupied.add(candidate.toLocaleLowerCase());
            return candidate;
        }
    }
    throw new Error(`无法为文件“${fileName}”分配不冲突的目标名`);
}

/** 由状态内容确定性推导的 v4 形态 UUID；同状态两次计划得到同一 ID。 */
function deterministicUuid(input: string): string {
    const digest = createHash("sha256").update(input, "utf8").digest();
    digest[6] = (digest[6]! & 0x0f) | 0x40;
    digest[8] = (digest[8]! & 0x3f) | 0x80;
    const hex = digest.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function deterministicSuffix(input: string): string {
    return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 8);
}

async function pathExistsCaseInsensitive(directory: string, fileName: string): Promise<boolean> {
    const lower = fileName.toLocaleLowerCase();
    for (const entry of await readDirectoryEntries(directory)) {
        if (entry.name.toLocaleLowerCase() === lower) return true;
    }
    return false;
}

/** 校验迁移前后角色数、视觉文件数、字节数与内容哈希一致。 */
async function verifyMigrationCounts(projectRoot: string, plan: GroupMigrationPlan): Promise<void> {
    const defaultDirectory = defaultGroupDirectoryForMigration(projectRoot);
    for (const character of plan.characters) {
        const directory = path.join(defaultDirectory, character.characterId);
        for (const file of character.files) {
            const raw = await readBytesAllowMissing(path.join(directory, file.targetFileName));
            if (file.invalid) {
                if (raw.length !== file.bytes) {
                    throw new Error(`迁移校验失败：损坏文件字节数不一致（${character.characterId}/${file.sourceFileName}）`);
                }
                continue;
            }
            const parsed = parseCharacterVisualJson(new TextDecoder().decode(raw));
            if (parsed.visualId !== file.nextVisualId) {
                throw new Error(`迁移校验失败：视觉 ID 不一致（${character.characterId}/${file.sourceFileName}）`);
            }
            const expected = file.visualIdChanged
                ? hashText(renderCharacterVisualJson({...parsed, visualId: file.nextVisualId}))
                : file.contentHash;
            if (hashBytes(raw) !== expected) {
                throw new Error(`迁移校验失败：内容哈希不一致（${character.characterId}/${file.sourceFileName}）`);
            }
        }
    }
}

async function migrateManagedReferences(projectRoot: string, plan: GroupMigrationPlan): Promise<void> {
    const managedPath = sendDataPath(projectRoot);
    if (!await pathExists(managedPath)) return;
    const raw = JSON.parse(await fs.readFile(managedPath, "utf8")) as Record<string, unknown>;
    const map = new Map(plan.refMap.map((mapping) => [mapping.old.visualId, mapping.next.visualId]));
    const rewrite = (list: unknown): void => {
        if (!Array.isArray(list)) return;
        for (const item of list) {
            if (typeof item !== "object" || item === null) continue;
            const record = item as Record<string, unknown>;
            if (record.groupId === plan.groupId) {
                record.groupId = "default";
                if (typeof record.visualId === "string") {
                    record.visualId = map.get(record.visualId) ?? record.visualId;
                }
            }
        }
    };
    rewrite(raw.characterSelections);
    rewrite(raw.outfitSelections);
    await writeJsonAtomic(managedPath, raw);
}

/** 回滚：恢复旧 default、旧分组清单、旧引用和来源组目录。 */
async function rollbackGroupMigration(
    projectRoot: string,
    log: GroupMigrationJournalPayload,
    transactionDirectory: string,
    transactionId: string,
): Promise<void> {
    try {
        const defaultDirectory = defaultGroupDirectoryForMigration(projectRoot);
        const backupDirectory = path.join(transactionDirectory, "backup");
        const sourceBackupDirectory = path.join(backupDirectory, "source");
        const defaultBackupDirectory = path.join(backupDirectory, "default");
        // 整目录移入 default 的先移回来源备份，避免被当作新建目录删除。
        for (const name of log.movedWholeDirectories) {
            await restoreRename(path.join(defaultDirectory, name), path.join(sourceBackupDirectory, name));
        }
        for (const name of log.builtTargetDirectories) {
            await fs.rm(path.join(defaultDirectory, name), {recursive: true, force: true});
        }
        for (const name of log.backedUpDefaultDirectories) {
            await restoreRename(path.join(defaultBackupDirectory, name), path.join(defaultDirectory, name));
        }
        for (const name of log.movedSourceEntries) {
            // 来源组目录可能在提交后期已被删除；回滚时重建后再恢复。
            await restoreRename(path.join(sourceBackupDirectory, name), path.join(log.sourceGroupDirectory, name));
        }
        if (log.groupsBackedUp) {
            await fs.copyFile(
                path.join(backupDirectory, GROUPS_FILE),
                path.join(projectRoot, LIBRARY_DIRECTORY, GROUPS_FILE),
            );
        }
        if (log.sendDataBackedUp) {
            await fs.copyFile(path.join(backupDirectory, SEND_DATA_FILE), sendDataPath(projectRoot));
        }
    } finally {
        await fs.rm(transactionDirectory, {recursive: true, force: true});
        await removeTransactionJournal(projectRoot, transactionId);
    }
}

/**
 * 分组迁移事务的单条恢复入口：由统一恢复调度器按 kind 分派，
 * 只处理自己 kind 的日志；committed 状态只做收尾清理。
 */
export async function recoverGroupMigrationJournal(
    projectRoot: string,
    envelope: TransactionJournalEnvelope,
): Promise<void> {
    if (envelope.kind !== JOURNAL_KIND) {
        throw new Error(`分组迁移恢复器收到非法事务种类：${envelope.kind}`);
    }
    const payload = envelope.payload as unknown as GroupMigrationJournalPayload;
    const transactionDirectory = path.join(groupMigrationTransactionRoot(projectRoot), envelope.transactionId);
    if (envelope.state === "committed") {
        // 数据已提交，只剩清理：完成收尾。
        await fs.rm(transactionDirectory, {recursive: true, force: true});
        await removeTransactionJournal(projectRoot, envelope.transactionId);
        return;
    }
    await rollbackGroupMigration(projectRoot, payload, transactionDirectory, envelope.transactionId);
}

export async function readMigrationGroups(projectRoot: string): Promise<GroupMigrationGroupsFile> {
    const filePath = path.join(projectRoot, LIBRARY_DIRECTORY, GROUPS_FILE);
    return JSON.parse(await fs.readFile(filePath, "utf8")) as GroupMigrationGroupsFile;
}

export async function readMigrationSendData(projectRoot: string): Promise<unknown> {
    try {
        return JSON.parse(await fs.readFile(sendDataPath(projectRoot), "utf8")) as unknown;
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return null;
        throw error;
    }
}

/** Project 级视觉库排他锁（可重入）；恢复、迁移与写入共用同一把锁。 */
export async function withGroupMigrationLock<T>(
    projectRoot: string,
    task: () => Promise<T>,
    options: {lockTimeoutMs?: number} = {},
): Promise<T> {
    return withVisualLibraryProjectLock(projectRoot, task, options);
}

export async function collectDefaultState(defaultDirectory: string): Promise<unknown[]> {
    const result: unknown[] = [];
    for (const entry of await readDirectoryEntries(defaultDirectory)) {
        if (!entry.isDirectory()) continue;
        const manifest = await readMigrationManifest(path.join(defaultDirectory, entry.name), entry.name);
        const files: unknown[] = [];
        for (const visual of manifest?.visuals ?? []) {
            const raw = await readBytesAllowMissing(path.join(defaultDirectory, entry.name, visual.fileName));
            files.push({visualId: visual.visualId, fileName: visual.fileName, hash: hashBytes(raw), bytes: raw.length});
        }
        result.push({characterId: entry.name, manifest, files});
    }
    return result;
}

async function readMigrationManifest(directory: string, characterId: string): Promise<GroupMigrationManifest | null> {
    try {
        const raw = JSON.parse(await fs.readFile(path.join(directory, MANIFEST_FILE), "utf8")) as Partial<GroupMigrationManifest>;
        if (!Array.isArray(raw.visuals)) return null;
        return {
            schema: "nbook.character-visual-collection/v1",
            characterId,
            activeVisualId: typeof raw.activeVisualId === "string" ? raw.activeVisualId : null,
            visuals: raw.visuals.filter((item): item is GroupMigrationManifest["visuals"][number] => (
                typeof item === "object" && item !== null
                && typeof item.visualId === "string"
                && typeof item.fileName === "string"
                && typeof item.createdAt === "string"
                && typeof item.updatedAt === "string"
                && (item.source === "manual" || item.source === "llm" || item.source === "migration" || item.source === "copy")
            )),
        };
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return null;
        throw error;
    }
}

async function writeMigrationLog(
    projectRoot: string,
    transactionId: string,
    state: GroupMigrationJournalState,
    payload: GroupMigrationJournalPayload,
): Promise<void> {
    await writeTransactionJournal(projectRoot, buildTransactionEnvelope({
        kind: JOURNAL_KIND,
        transactionId,
        state,
        payload,
    }));
}

async function readDirectoryEntries(directory: string): Promise<import("node:fs").Dirent[]> {
    try {
        return await fs.readdir(directory, {withFileTypes: true});
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return [];
        throw error;
    }
}

async function renameAllowMissing(source: string, target: string): Promise<void> {
    try {
        await fs.rename(source, target);
    } catch (error) {
        if (!isErrorCode(error, "ENOENT")) throw error;
    }
}

/** 回滚用 rename：重建目标父目录；来源缺失但目标已存在视为已恢复（恢复重入），两者都缺失才失败。 */
async function restoreRename(source: string, target: string): Promise<void> {
    if (!await pathExists(source)) {
        if (await pathExists(target)) return;
        throw new Error(`回滚失败：备份与目标都不存在（${source}）`);
    }
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.rename(source, target);
}

async function readBytesAllowMissing(filePath: string): Promise<Buffer> {
    try {
        return await fs.readFile(filePath);
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return Buffer.alloc(0);
        throw error;
    }
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return false;
        throw error;
    }
}

function hashBytes(input: Buffer): string {
    return createHash("sha256").update(input).digest("hex");
}

function hashText(input: string): string {
    return createHash("sha256").update(input, "utf8").digest("hex");
}

async function injectFailure(failAt: GroupMigrationDependencies["failAt"], stage: NonNullable<GroupMigrationDependencies["failAt"]>): Promise<void> {
    if (failAt === stage) throw new Error(`故障注入：${stage}`);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
