import fs from "node:fs/promises";
import path from "node:path";
import {
    parseCharacterVisualJson,
    type CharacterVisualFile,
} from "nbook/server/text-to-image/character-visual.codec";
import {
    TRIGGER_WORD_FORMAT_MARKER,
    parsePipeCharacterTriggers,
    type ParsedCharacterTriggers,
} from "nbook/server/text-to-image/character-trigger-words";
import {
    readMigrationGroups,
    withGroupMigrationLock,
    type GroupMigrationDependencies,
} from "nbook/server/text-to-image/character-group-migration";
import {
    buildTransactionEnvelope,
    newTransactionId,
    removeTransactionJournal,
    transactionJournalRoot,
    VISUAL_LIBRARY_DIRECTORY,
    writeJsonAtomic,
    writeTransactionJournal,
    type TransactionJournalEnvelope,
} from "nbook/server/text-to-image/transaction-journal";

const LIBRARY_DIRECTORY = VISUAL_LIBRARY_DIRECTORY;
const GROUPS_FILE = "character-groups.json";
const GROUP_DIRECTORY = "character-groups";
const MANIFEST_FILE = "manifest.json";
const JOURNAL_KIND = "trigger-words-v1";

export type TriggerWordsMigrationStats = {
    scannedFiles: number;
    convertedFiles: number;
    unchangedFiles: number;
    damagedFiles: number;
    markerBefore: string | null;
    markerAfter: string | null;
};

export type TriggerWordsMigrationDependencies = Omit<GroupMigrationDependencies, "failAt"> & {
    /** 测试注入：在指定阶段抛出异常，验证回滚。 */
    failAt?: "stage" | "backup" | "commit_files" | "verify" | "commit_marker";
};

type TriggerWordsMigrationJournalState = "preparing" | "backed-up" | "files-committed" | "marker-committed" | "committed";

type TriggerWordsMigrationJournalPayload = {
    files: Array<{absolutePath: string; backupPath: string}>;
    groupsFilePath: string;
    groupsBackedUp: boolean;
};

/**
 * 历史逗号格式的一次性迁移。逗号拆分逻辑只存在于本模块的私有函数中，
 * 不得被正常保存、解析或扫描路径导入。
 */
export async function migrateProjectTriggerWords(
    projectRoot: string,
    options: TriggerWordsMigrationDependencies = {},
): Promise<TriggerWordsMigrationStats> {
    const markerBefore = await readFormatMarker(projectRoot);
    if (markerBefore === TRIGGER_WORD_FORMAT_MARKER) {
        return {
            scannedFiles: 0,
            convertedFiles: 0,
            unchangedFiles: 0,
            damagedFiles: 0,
            markerBefore,
            markerAfter: markerBefore,
        };
    }
    return withGroupMigrationLock(projectRoot, async () => {
        // 锁内重新判断：两个 Project 进程并发首次访问时只有一个执行迁移。
        const marker = await readFormatMarker(projectRoot);
        if (marker === TRIGGER_WORD_FORMAT_MARKER) {
            return {
                scannedFiles: 0,
                convertedFiles: 0,
                unchangedFiles: 0,
                damagedFiles: 0,
                markerBefore: marker,
                markerAfter: marker,
            };
        }
        await ensureGroupsFile(projectRoot);
        await injectFailure(options.failAt, "stage");

        const transactionId = newTransactionId();
        const transactionRoot = transactionDirectoryRoot(projectRoot);
        await fs.mkdir(transactionRoot, {recursive: true});
        const transactionDirectory = path.join(transactionRoot, transactionId);
        const backupDirectory = path.join(transactionDirectory, "backup");
        const groupsPath = groupsFilePath(projectRoot);
        const log: TriggerWordsMigrationJournalPayload = {
            files: [],
            groupsFilePath: groupsPath,
            groupsBackedUp: false,
        };
        const writeLog = (state: TriggerWordsMigrationJournalState): Promise<void> => (
            writeJournal(projectRoot, transactionId, state, log)
        );

        try {
            await fs.mkdir(backupDirectory, {recursive: true});
            await writeLog("preparing");

            await fs.copyFile(groupsPath, path.join(backupDirectory, GROUPS_FILE));
            log.groupsBackedUp = true;
            await writeLog("backed-up");
            await injectFailure(options.failAt, "backup");

            const targets = await collectMigrationTargets(projectRoot);
            let convertedFiles = 0;
            let unchangedFiles = 0;
            let damagedFiles = 0;
            for (const target of targets) {
                if (target.visual === null) {
                    damagedFiles += 1;
                    continue;
                }
                const current = target.visual.character.triggerWords ?? "";
                const canonical = parseLegacyCommaTriggersForMigration(current).canonical;
                if (canonical === current) {
                    unchangedFiles += 1;
                    continue;
                }
                const relativeKey = target.relativeKey.replaceAll("\\", "/");
                const backupPath = path.join(backupDirectory, relativeKey);
                await fs.mkdir(path.dirname(backupPath), {recursive: true});
                await fs.copyFile(target.absolutePath, backupPath);
                log.files.push({absolutePath: target.absolutePath, backupPath});
                const next = {...target.visual, character: {...target.visual.character, triggerWords: canonical}};
                await writeJsonAtomic(target.absolutePath, next);
                convertedFiles += 1;
                await injectFailure(options.failAt, "commit_files");
            }

            // 复读校验：全部写入成功且与规范格式一致后才提交标记。
            for (const file of log.files) {
                const parsed = await readMigrationTarget(file.absolutePath);
                if (parsed === null || parsePipeCharacterTriggers(parsed.character.triggerWords ?? "").canonical !== parsed.character.triggerWords) {
                    throw new Error(`触发词迁移校验失败：${path.relative(projectRoot, file.absolutePath)}`);
                }
            }
            await injectFailure(options.failAt, "verify");
            await writeLog("files-committed");

            await writeFormatMarker(projectRoot);
            await writeLog("marker-committed");
            await injectFailure(options.failAt, "commit_marker");

            await writeLog("committed");
            await fs.rm(transactionDirectory, {recursive: true, force: true});
            await removeTransactionJournal(projectRoot, transactionId);
            return {
                scannedFiles: targets.length,
                convertedFiles,
                unchangedFiles,
                damagedFiles,
                markerBefore: marker,
                markerAfter: TRIGGER_WORD_FORMAT_MARKER,
            };
        } catch (error) {
            await rollbackTriggerWordsMigration(projectRoot, transactionId, log, transactionDirectory);
            throw error;
        }
    }, options);
}

/** 触发词迁移事务的单条恢复入口：由统一恢复调度器按 kind 分派，只处理自己 kind 的日志。 */
export async function recoverTriggerWordsMigrationJournal(
    projectRoot: string,
    envelope: TransactionJournalEnvelope,
): Promise<void> {
    if (envelope.kind !== JOURNAL_KIND) {
        throw new Error(`触发词迁移恢复器收到非法事务种类：${envelope.kind}`);
    }
    const payload = envelope.payload as unknown as TriggerWordsMigrationJournalPayload;
    const transactionDirectory = path.join(transactionJournalRoot(projectRoot), envelope.transactionId);
    if (envelope.state === "committed") {
        await fs.rm(transactionDirectory, {recursive: true, force: true});
        await removeTransactionJournal(projectRoot, envelope.transactionId);
        return;
    }
    await rollbackTriggerWordsMigration(projectRoot, envelope.transactionId, payload, transactionDirectory);
}

function transactionDirectoryRoot(projectRoot: string): string {
    return transactionJournalRoot(projectRoot);
}

function groupsFilePath(projectRoot: string): string {
    return path.join(projectRoot, LIBRARY_DIRECTORY, GROUPS_FILE);
}

async function readFormatMarker(projectRoot: string): Promise<string | null> {
    try {
        const groups = await readMigrationGroups(projectRoot) as unknown as {triggerWordsFormat?: unknown};
        return typeof groups.triggerWordsFormat === "string" ? groups.triggerWordsFormat : null;
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return null;
        throw error;
    }
}

async function writeFormatMarker(projectRoot: string): Promise<void> {
    const groupsPath = groupsFilePath(projectRoot);
    const groups = JSON.parse(await fs.readFile(groupsPath, "utf8")) as Record<string, unknown>;
    groups.triggerWordsFormat = TRIGGER_WORD_FORMAT_MARKER;
    await writeJsonAtomic(groupsPath, groups);
}

async function ensureGroupsFile(projectRoot: string): Promise<void> {
    const groupsPath = groupsFilePath(projectRoot);
    if (await pathExists(groupsPath)) return;
    await fs.mkdir(path.dirname(groupsPath), {recursive: true});
    await writeJsonAtomic(groupsPath, {
        schema: "nbook.character-groups/v2",
        groups: [{groupId: "default", name: "默认分组", description: "", enabled: true, sortOrder: 0}],
    });
}

async function collectMigrationTargets(projectRoot: string): Promise<Array<{absolutePath: string; relativeKey: string; visual: CharacterVisualFile | null}>> {
    const groupsDirectory = path.join(projectRoot, LIBRARY_DIRECTORY, GROUP_DIRECTORY);
    const targets: Array<{absolutePath: string; relativeKey: string; visual: CharacterVisualFile | null}> = [];
    for (const group of await readDirectoryEntries(groupsDirectory)) {
        if (!group.isDirectory()) continue;
        for (const character of await readDirectoryEntries(path.join(groupsDirectory, group.name))) {
            if (!character.isDirectory()) continue;
            const characterDirectory = path.join(groupsDirectory, group.name, character.name);
            let manifest: {visuals?: unknown} | null = null;
            try {
                manifest = JSON.parse(await fs.readFile(path.join(characterDirectory, MANIFEST_FILE), "utf8")) as {visuals?: unknown};
            } catch {
                continue;
            }
            if (!Array.isArray(manifest.visuals)) continue;
            for (const visual of manifest.visuals) {
                if (typeof visual !== "object" || visual === null || typeof (visual as Record<string, unknown>).fileName !== "string") continue;
                const fileName = (visual as Record<string, unknown>).fileName as string;
                targets.push({
                    absolutePath: path.join(characterDirectory, fileName),
                    relativeKey: path.join(GROUP_DIRECTORY, group.name, character.name, fileName),
                    visual: await readMigrationTarget(path.join(characterDirectory, fileName)),
                });
            }
        }
    }
    return targets.sort((left, right) => left.absolutePath.localeCompare(right.absolutePath));
}

/** 读单个视觉文件；损坏 JSON 返回 null（不丢弃、不隐藏，记入迁移警告）。 */
async function readMigrationTarget(filePath: string): Promise<CharacterVisualFile | null> {
    try {
        return parseCharacterVisualJson(await fs.readFile(filePath, "utf8"));
    } catch {
        return null;
    }
}

/**
 * 一次性迁移专用的旧合同解析：按 `,`、`，` 拆分。为了让输出能通过新合同的
 * 严格解析器往返（新合同里 `|` 是分隔符，不能残留在值内部），已手写的半角竖线
 * 也一并拆分；该函数只能被本模块调用。
 */
function parseLegacyCommaTriggersForMigration(raw: string): ParsedCharacterTriggers {
    const values: string[] = [];
    const seen = new Set<string>();
    for (const part of raw.split(/[,，|]/u)) {
        const value = part.trim();
        if (value === "") continue;
        const key = value.normalize("NFKC").toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(value);
    }
    return {values, canonical: values.join(" | ")};
}

async function rollbackTriggerWordsMigration(
    projectRoot: string,
    transactionId: string,
    log: TriggerWordsMigrationJournalPayload,
    transactionDirectory: string,
): Promise<void> {
    try {
        for (const file of log.files) {
            if (await pathExists(file.backupPath)) {
                await fs.mkdir(path.dirname(file.absolutePath), {recursive: true});
                await fs.copyFile(file.backupPath, file.absolutePath);
            }
        }
        if (log.groupsBackedUp) {
            const backupGroups = path.join(transactionDirectory, "backup", GROUPS_FILE);
            if (await pathExists(backupGroups)) {
                await fs.copyFile(backupGroups, log.groupsFilePath);
            }
        }
    } finally {
        await fs.rm(transactionDirectory, {recursive: true, force: true});
        await removeTransactionJournal(projectRoot, transactionId);
    }
}

async function writeJournal(
    projectRoot: string,
    transactionId: string,
    state: TriggerWordsMigrationJournalState,
    payload: TriggerWordsMigrationJournalPayload,
): Promise<void> {
    await writeTransactionJournal(projectRoot, buildTransactionEnvelope({
        kind: JOURNAL_KIND,
        transactionId,
        state,
        payload: payload as unknown as Record<string, unknown>,
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

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return false;
        throw error;
    }
}

async function injectFailure(failAt: TriggerWordsMigrationDependencies["failAt"] | undefined, stage: NonNullable<TriggerWordsMigrationDependencies["failAt"]>): Promise<void> {
    if (failAt === stage) throw new Error(`故障注入：${stage}`);
}

function isErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
