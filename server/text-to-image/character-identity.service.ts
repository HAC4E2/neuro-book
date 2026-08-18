import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    CharacterVisualFileSchema,
    parseCharacterVisualJson,
    type CharacterVisualFile,
} from "nbook/server/text-to-image/character-visual.codec";
import {canonicalizeTriggerWords} from "nbook/server/text-to-image/character-trigger-words";
import {
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
const GROUP_DIRECTORY = "character-groups";
const MANIFEST_FILE = "manifest.json";
const TRANSACTION_DIRECTORY = ".txn";
const JOURNAL_KIND = "identity-v1";

export type CharacterIdentity = {
    cnName: string;
    enName: string;
    triggerWords: string;
};

export type CharacterIdentityFileSummary = {
    groupId: string;
    visualId: string;
    updatedAt: string;
    identity: CharacterIdentity;
};

export type CharacterIdentitySummary = {
    revision: string;
    groupCount: number;
    fileCount: number;
    identity: CharacterIdentity | null;
    damagedFiles: string[];
    files: CharacterIdentityFileSummary[];
};

export type IdentityTransactionDependencies = Omit<GroupMigrationDependencies, "failAt"> & {
    /** 测试注入：在指定阶段抛出异常，验证回滚。 */
    failAt?: "stage" | "backup" | "commit_files" | "verify";
};

export class CharacterIdentityRevisionConflictError extends Error {
    readonly code = "TEXT_TO_IMAGE_IDENTITY_REVISION_CONFLICT";

    constructor(readonly characterId: string) {
        super(`角色“${characterId}”的身份在读取摘要后发生了变化，请重新保存。`);
        this.name = "CharacterIdentityRevisionConflictError";
    }
}

export class CharacterIdentityDamagedFileError extends Error {
    readonly code = "TEXT_TO_IMAGE_IDENTITY_DAMAGED_FILE";
    readonly files: string[];

    constructor(characterId: string, files: string[]) {
        super(`角色“${characterId}”存在无法解析的视觉 JSON：${files.join("、")}；修复前不能安全同步身份。`);
        this.name = "CharacterIdentityDamagedFileError";
        this.files = files;
    }
}

type IdentityTransactionJournalState = "preparing" | "backed-up" | "files-committed" | "committed";

type IdentityTransactionJournalPayload = {
    files: Array<{absolutePath: string; backupPath: string}>;
    manifests: Array<{absolutePath: string; backupPath: string}>;
};

/** 规范化身份；触发词格式错误直接抛 TriggerWordFormatError。 */
export function normalizeCharacterIdentity(input: CharacterIdentity): CharacterIdentity {
    return {
        cnName: input.cnName.trim(),
        enName: input.enName.trim(),
        triggerWords: canonicalizeTriggerWords(input.triggerWords),
    };
}

/** 计算身份 revision：覆盖该角色全部版本的身份三元组、位置与 updatedAt。 */
export function computeCharacterIdentityRevision(files: CharacterIdentityFileSummary[]): string {
    const normalized = files
        .map((file) => ({
            groupId: file.groupId,
            visualId: file.visualId,
            updatedAt: file.updatedAt,
            identity: {
                cnName: file.identity.cnName.trim(),
                enName: file.identity.enName.trim(),
                triggerWords: canonicalizeTriggerWords(file.identity.triggerWords),
            },
        }))
        .sort((left, right) => `${left.groupId}\u0000${left.visualId}`.localeCompare(`${right.groupId}\u0000${right.visualId}`));
    return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/** 只读摘要：供身份保存预览、并发保护与 API 返回。 */
export async function readCharacterIdentitySummary(projectRoot: string, characterId: string): Promise<CharacterIdentitySummary> {
    const files = await collectCharacterIdentityFiles(projectRoot, characterId);
    if (files.files.length === 0) {
        throw new Error(`未找到角色“${characterId}”的视觉资料`);
    }
    return {
        revision: computeCharacterIdentityRevision(files.files),
        groupCount: files.groupCount,
        fileCount: files.files.length,
        identity: files.files[0]?.identity ?? null,
        damagedFiles: files.damagedFiles,
        files: files.files,
    };
}

/**
 * 在同一 Project 写锁与事务内同步该 characterId 的全部视觉 JSON 的身份字段，
 * 可同时提交当前选中视觉的非身份修改。任一文件损坏或任一步失败整体回滚。
 */
export async function updateCharacterIdentity(
    input: {
        projectRoot: string;
        characterId: string;
        identity: CharacterIdentity;
        selectedVisual?: {
            groupId: string;
            visualId: string;
            expectedUpdatedAt?: string;
            visual: CharacterVisualFile;
        } | null;
        expectedIdentityRevision?: string | null;
    },
    options: IdentityTransactionDependencies = {},
): Promise<{
    updatedFileCount: number;
    groupCount: number;
    identity: CharacterIdentity;
    currentVisualRevision: string | null;
}> {
    const identity = normalizeCharacterIdentity(input.identity);
    const selectedVisual = input.selectedVisual ?? null;

    return withGroupMigrationLock(input.projectRoot, async () => {
        const collected = await collectCharacterIdentityFiles(input.projectRoot, input.characterId);
        if (collected.files.length === 0) {
            throw new Error(`未找到角色“${input.characterId}”的视觉资料`);
        }
        const revision = computeCharacterIdentityRevision(collected.files);
        if (input.expectedIdentityRevision != null && input.expectedIdentityRevision !== revision) {
            throw new CharacterIdentityRevisionConflictError(input.characterId);
        }
        if (collected.damagedFiles.length > 0) {
            throw new CharacterIdentityDamagedFileError(input.characterId, collected.damagedFiles);
        }
        // 选中视觉的 updatedAt 校验：锁内重读，避免把并发修改当成基线。
        const selected = selectedVisual ? collected.files.find((file) => (
            file.groupId === selectedVisual.groupId && file.visualId === selectedVisual.visualId
        )) : null;
        if (selectedVisual && !selected) {
            throw new Error("未找到要同步修改的选中视觉资料");
        }
        if (selectedVisual?.expectedUpdatedAt && selected && selected.updatedAt !== selectedVisual.expectedUpdatedAt) {
            throw new CharacterIdentityRevisionConflictError(input.characterId);
        }
        await injectFailure(options.failAt, "stage");

        const transactionId = newTransactionId();
        const transactionRoot = transactionDirectoryRoot(input.projectRoot);
        await fs.mkdir(transactionRoot, {recursive: true});
        const transactionDirectory = path.join(transactionRoot, transactionId);
        const backupDirectory = path.join(transactionDirectory, "backup");
        const log: IdentityTransactionJournalPayload = {
            files: [],
            manifests: [],
        };
        const writeLog = (state: IdentityTransactionJournalState): Promise<void> => (
            writeJournal(input.projectRoot, transactionId, state, log)
        );

        try {
            await fs.mkdir(backupDirectory, {recursive: true});
            await writeLog("preparing");

            const plan = await buildIdentityWritePlan(input.projectRoot, input.characterId, identity, selectedVisual);
            // 备份全部要改写的视觉文件与 manifest。
            for (const file of plan.files) {
                const relativeKey = path.relative(input.projectRoot, file.absolutePath).replaceAll("\\", "/");
                const backupPath = path.join(backupDirectory, relativeKey);
                await fs.mkdir(path.dirname(backupPath), {recursive: true});
                await fs.copyFile(file.absolutePath, backupPath);
                log.files.push({absolutePath: file.absolutePath, backupPath});
            }
            for (const manifest of plan.manifests) {
                const relativeKey = path.relative(input.projectRoot, manifest.absolutePath).replaceAll("\\", "/");
                const backupPath = path.join(backupDirectory, relativeKey);
                await fs.mkdir(path.dirname(backupPath), {recursive: true});
                await fs.copyFile(manifest.absolutePath, backupPath);
                log.manifests.push({absolutePath: manifest.absolutePath, backupPath});
            }
            await writeLog("backed-up");
            await injectFailure(options.failAt, "backup");

            for (const file of plan.files) {
                await writeJsonAtomic(file.absolutePath, file.next);
            }
            await injectFailure(options.failAt, "commit_files");
            for (const manifest of plan.manifests) {
                await writeJsonAtomic(manifest.absolutePath, manifest.next);
            }

            // 复读校验：全部文件身份一致、选中视觉内容一致。
            for (const file of plan.files) {
                const reread = await readVisualFile(file.absolutePath);
                if (!reread || !sameIdentity(reread.character, identity)) {
                    throw new Error(`身份同步校验失败：${path.relative(input.projectRoot, file.absolutePath)}`);
                }
            }
            if (selectedVisual && selected) {
                const reread = await readVisualFile(plan.selectedAbsolutePath);
                if (!reread) throw new Error("身份同步校验失败：选中视觉不可读");
                const expected = plan.selectedNext;
                if (!reread || JSON.stringify(reread.character) !== JSON.stringify(expected.character)
                    || JSON.stringify(reread.outfits) !== JSON.stringify(expected.outfits)
                    || JSON.stringify(reread.photos) !== JSON.stringify(expected.photos)) {
                    throw new Error("身份同步校验失败：选中视觉内容不一致");
                }
            }
            await injectFailure(options.failAt, "verify");
            await writeLog("files-committed");
            await writeLog("committed");
            await fs.rm(transactionDirectory, {recursive: true, force: true});
            await removeTransactionJournal(input.projectRoot, transactionId);

            return {
                updatedFileCount: plan.files.length,
                groupCount: collected.groupCount,
                identity,
                currentVisualRevision: selected
                    ? plan.files.find((file) => file.absolutePath === plan.selectedAbsolutePath)?.nextUpdatedAt ?? null
                    : null,
            };
        } catch (error) {
            await rollbackIdentityTransaction(input.projectRoot, transactionId, log, transactionDirectory);
            throw error;
        }
    }, options);
}

/** 身份事务的单条恢复入口：由统一恢复调度器按 kind 分派，只处理自己 kind 的日志。 */
export async function recoverIdentityJournal(
    projectRoot: string,
    envelope: TransactionJournalEnvelope,
): Promise<void> {
    if (envelope.kind !== JOURNAL_KIND) {
        throw new Error(`身份恢复器收到非法事务种类：${envelope.kind}`);
    }
    const payload = envelope.payload as unknown as IdentityTransactionJournalPayload;
    const transactionDirectory = path.join(transactionJournalRoot(projectRoot), envelope.transactionId);
    if (envelope.state === "committed") {
        await fs.rm(transactionDirectory, {recursive: true, force: true});
        await removeTransactionJournal(projectRoot, envelope.transactionId);
        return;
    }
    await rollbackIdentityTransaction(projectRoot, envelope.transactionId, payload, transactionDirectory);
}

type IdentityFilePlan = {
    absolutePath: string;
    next: CharacterVisualFile;
    nextUpdatedAt: string | null;
};

type IdentityWritePlan = {
    files: IdentityFilePlan[];
    manifests: Array<{absolutePath: string; next: unknown}>;
    selectedAbsolutePath: string;
    selectedNext: CharacterVisualFile;
};

async function buildIdentityWritePlan(
    projectRoot: string,
    characterId: string,
    identity: CharacterIdentity,
    selectedVisual: {groupId: string; visualId: string; expectedUpdatedAt?: string; visual: CharacterVisualFile} | null,
): Promise<IdentityWritePlan> {
    const collected = await collectCharacterIdentityFiles(projectRoot, characterId);
    const now = new Date().toISOString();
    const files: IdentityFilePlan[] = [];
    const manifestPaths = new Map<string, string>();
    const manifests: IdentityWritePlan["manifests"] = [];
    let selectedAbsolutePath = "";
    let selectedNext: CharacterVisualFile | null = null;

    for (const summary of collected.files) {
        const directory = characterDirectory(projectRoot, summary.groupId, characterId);
        const manifestPath = path.join(directory, MANIFEST_FILE);
        manifestPaths.set(`${summary.groupId}\u0000${characterId}`, manifestPath);
        const filePath = await resolveVisualFilePath(directory, summary.visualId);
        const current = await readVisualFile(filePath);
        if (!current) throw new CharacterIdentityDamagedFileError(characterId, [safeFileId(summary.groupId, characterId, summary.visualId)]);
        const isSelected = selectedVisual !== null && summary.groupId === selectedVisual.groupId && summary.visualId === selectedVisual.visualId;
        const next = CharacterVisualFileSchema.parse(isSelected
            ? {
                schema: "nbook.character-visual/v1",
                visualId: current.visualId,
                characterId,
                character: {...selectedVisual!.visual.character, cnName: identity.cnName, enName: identity.enName, triggerWords: identity.triggerWords},
                outfits: selectedVisual!.visual.outfits.map((outfit) => ({...outfit})),
                photos: [...selectedVisual!.visual.photos],
            }
            : {
                ...current,
                character: {...current.character, cnName: identity.cnName, enName: identity.enName, triggerWords: identity.triggerWords},
            });
        const changed = !sameIdentity(current.character, identity)
            || (isSelected && (JSON.stringify(current.character) !== JSON.stringify(next.character)
                || JSON.stringify(current.outfits) !== JSON.stringify(next.outfits)
                || JSON.stringify(current.photos) !== JSON.stringify(next.photos)));
        if (!changed) continue;
        files.push({absolutePath: filePath, next, nextUpdatedAt: now});
        if (isSelected) {
            selectedAbsolutePath = filePath;
            selectedNext = next;
        }
    }

    for (const [key, manifestPath] of manifestPaths) {
        const [groupId] = key.split("\u0000");
        const manifest = await readManifestRaw(manifestPath, characterId);
        if (!manifest) continue;
        const touched = new Set(files
            .filter((file) => file.absolutePath.startsWith(path.join(characterDirectory(projectRoot, groupId!, characterId)) + path.sep))
            .map((file) => file.next.visualId ?? ""));
        if (touched.size === 0) continue;
        const next = {
            ...manifest,
            visuals: manifest.visuals.map((visual) => touched.has(visual.visualId)
                ? {...visual, updatedAt: now}
                : visual),
        };
        manifests.push({absolutePath: manifestPath, next});
    }

    if (files.length === 0) {
        throw new Error("身份没有变化，无需保存");
    }
    return {
        files,
        manifests,
        selectedAbsolutePath,
        selectedNext: selectedNext ?? files[0]!.next,
    };
}

async function collectCharacterIdentityFiles(
    projectRoot: string,
    characterId: string,
): Promise<{groupCount: number; files: CharacterIdentityFileSummary[]; damagedFiles: string[]}> {
    const groupsDirectory = path.join(projectRoot, LIBRARY_DIRECTORY, GROUP_DIRECTORY);
    const files: CharacterIdentityFileSummary[] = [];
    const damagedFiles: string[] = [];
    const seenGroups = new Set<string>();
    for (const group of await readDirectoryEntries(groupsDirectory)) {
        if (!group.isDirectory()) continue;
        const directory = path.join(groupsDirectory, group.name, characterId);
        const manifest = await readManifestRaw(path.join(directory, MANIFEST_FILE), characterId);
        if (!manifest || manifest.visuals.length === 0) continue;
        for (const visual of manifest.visuals) {
            const parsed = await readVisualFile(path.join(directory, visual.fileName));
            if (parsed === null) {
                damagedFiles.push(safeFileId(group.name, characterId, visual.visualId));
                continue;
            }
            files.push({
                groupId: group.name,
                visualId: visual.visualId,
                updatedAt: visual.updatedAt,
                identity: {
                    cnName: parsed.character.cnName ?? "",
                    enName: parsed.character.enName ?? "",
                    triggerWords: parsed.character.triggerWords ?? "",
                },
            });
        }
        seenGroups.add(group.name);
    }
    files.sort((left, right) => `${left.groupId}\u0000${left.visualId}`.localeCompare(`${right.groupId}\u0000${right.visualId}`));
    return {groupCount: seenGroups.size, files, damagedFiles};
}

function safeFileId(groupId: string, characterId: string, visualId: string): string {
    return `${groupId}/${characterId}/${visualId}`;
}

function characterDirectory(projectRoot: string, groupId: string, characterId: string): string {
    return path.join(projectRoot, LIBRARY_DIRECTORY, GROUP_DIRECTORY, groupId, characterId);
}

async function resolveVisualFilePath(directory: string, visualId: string): Promise<string> {
    const manifest = await readManifestRaw(path.join(directory, MANIFEST_FILE), path.basename(directory));
    const visual = manifest?.visuals.find((item) => item.visualId === visualId);
    if (!visual) throw new Error(`未找到视觉资料：${path.basename(directory)}/${visualId}`);
    return path.join(directory, visual.fileName);
}

async function readVisualFile(filePath: string): Promise<CharacterVisualFile | null> {
    try {
        return parseCharacterVisualJson(await fs.readFile(filePath, "utf8"));
    } catch {
        return null;
    }
}

async function readManifestRaw(filePath: string, characterId: string): Promise<{
    schema?: unknown;
    characterId?: unknown;
    activeVisualId?: unknown;
    visuals: Array<{visualId: string; fileName: string; createdAt?: string; updatedAt: string; source?: string}>;
} | null> {
    try {
        const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as {
            schema?: unknown;
            characterId?: unknown;
            activeVisualId?: unknown;
            visuals?: unknown;
        };
        if (!Array.isArray(raw.visuals)) return null;
        return {
            schema: raw.schema,
            characterId: raw.characterId,
            activeVisualId: raw.activeVisualId,
            visuals: raw.visuals.filter((item): item is {visualId: string; fileName: string; createdAt?: string; updatedAt: string; source?: string} => (
                typeof item === "object" && item !== null
                && typeof (item as Record<string, unknown>).visualId === "string"
                && typeof (item as Record<string, unknown>).fileName === "string"
                && typeof (item as Record<string, unknown>).updatedAt === "string"
            )),
        };
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return null;
        throw error;
    }
}

function sameIdentity(character: {cnName?: string; enName?: string; triggerWords?: string}, identity: CharacterIdentity): boolean {
    return (character.cnName ?? "").trim() === identity.cnName
        && (character.enName ?? "").trim() === identity.enName
        && canonicalizeTriggerWords(character.triggerWords ?? "") === identity.triggerWords;
}

async function rollbackIdentityTransaction(
    projectRoot: string,
    transactionId: string,
    log: IdentityTransactionJournalPayload,
    transactionDirectory: string,
): Promise<void> {
    try {
        for (const file of [...log.files, ...log.manifests]) {
            if (await pathExists(file.backupPath)) {
                await fs.mkdir(path.dirname(file.absolutePath), {recursive: true});
                await fs.copyFile(file.backupPath, file.absolutePath);
            }
        }
    } finally {
        await fs.rm(transactionDirectory, {recursive: true, force: true});
        await removeTransactionJournal(projectRoot, transactionId);
    }
}

function transactionDirectoryRoot(projectRoot: string): string {
    return transactionJournalRoot(projectRoot);
}

async function writeJournal(
    projectRoot: string,
    transactionId: string,
    state: IdentityTransactionJournalState,
    payload: IdentityTransactionJournalPayload,
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

async function injectFailure(failAt: IdentityTransactionDependencies["failAt"] | undefined, stage: NonNullable<IdentityTransactionDependencies["failAt"]>): Promise<void> {
    if (failAt === stage) throw new Error(`故障注入：${stage}`);
}

function isErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
