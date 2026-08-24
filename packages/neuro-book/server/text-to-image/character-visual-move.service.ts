import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    parseCharacterVisualJson,
    renderCharacterVisualJson,
    type CharacterVisualFile,
} from "nbook/server/text-to-image/character-visual.codec";
import {resolveTextToImageAssetPath} from "nbook/server/text-to-image/asset-path";
import {
    readMigrationGroups,
    readMigrationSendData,
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
const TRANSACTION_DIRECTORY = ".txn";
const SEND_DATA_FILE = "text-to-image-send-data.json";
const JOURNAL_KIND = "visual-move-v1";

export type VisualMoveRef = {
    groupId: string;
    characterId: string;
    visualId: string;
};

export type MoveCharacterVisualRequest = {
    sourceGroupId: string;
    sourceCharacterId: string;
    sourceVisualId: string;
    targetGroupId: string;
    expectedUpdatedAt?: string;
    expectedPreviewRevision?: string;
};

export type MoveCharacterVisualPreview = {
    revision: string;
    source: VisualMoveRef;
    targetGroupId: string;
    sourceWillLoseCharacter: boolean;
    sourceNeedsActiveFallback: boolean;
    targetCharacterExists: boolean;
    equivalentTargetRef: VisualMoveRef | null;
    equivalentTargetConflict: boolean;
    fileNameConflict: boolean;
    visualIdConflict: boolean;
    managedReferenceCount: number;
    sourceActive: boolean;
    sourceFileCount: number;
};

export type MoveCharacterVisualResult = {
    mode: "moved" | "merged-equivalent";
    ref: VisualMoveRef;
    info: {
        visualId: string;
        fileName: string;
        createdAt: string;
        updatedAt: string;
        source: "manual" | "llm" | "migration" | "copy";
        active: boolean;
    };
    visual: CharacterVisualFile;
    sourceCharacterRemoved: boolean;
    updatedManagedReferenceCount: number;
};

export type VisualMoveDependencies = Omit<GroupMigrationDependencies, "failAt"> & {
    /** 测试注入：在指定阶段抛出异常，验证回滚；crash 模拟进程中断，不回滚。 */
    failAt?: "stage" | "backup" | "commit_files" | "commit_refs" | "verify" | "crash";
};

export class VisualMoveInvalidTargetError extends Error {
    readonly code = "TEXT_TO_IMAGE_VISUAL_MOVE_INVALID_TARGET";

    constructor(message: string) {
        super(message);
        this.name = "VisualMoveInvalidTargetError";
    }
}

export class VisualMoveStaleSourceError extends Error {
    readonly code = "TEXT_TO_IMAGE_VISUAL_MOVE_STALE_SOURCE";

    constructor() {
        super("要移动的视觉资料在预检后已被修改，请重新查看后再移动。");
        this.name = "VisualMoveStaleSourceError";
    }
}

export class VisualMoveRevisionConflictError extends Error {
    readonly code = "TEXT_TO_IMAGE_VISUAL_MOVE_REVISION_CONFLICT";

    constructor() {
        super("分组数据在预检后发生了变化，请重新查看影响摘要后再确认移动。");
        this.name = "VisualMoveRevisionConflictError";
    }
}

export class VisualMoveEquivalentConflictError extends Error {
    readonly code = "TEXT_TO_IMAGE_VISUAL_MOVE_EQUIVALENT_CONFLICT";

    constructor() {
        super("目标分组存在多份相同内容，请先在目标分组处理重复项后再移动。");
        this.name = "VisualMoveEquivalentConflictError";
    }
}

type Manifest = {
    schema: string;
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

type VisualMovePlan = {
    sourceManifest: Manifest;
    targetManifest: Manifest | null;
    targetCharacterExists: boolean;
    sourceEntry: Manifest["visuals"][number];
    sourceVisual: CharacterVisualFile;
    contentHash: string;
    equivalentTargetRef: VisualMoveRef | null;
    equivalentTargetConflict: boolean;
    targetFileName: string;
    nextVisualId: string;
    fileNameRenamed: boolean;
    visualIdChanged: boolean;
    managedReferenceCount: number;
    sourceWillLoseCharacter: boolean;
    sourceNeedsActiveFallback: boolean;
    fallbackActiveVisualId: string | null;
};

type VisualMoveJournalState = "preparing" | "backed-up" | "files-committed" | "refs-committed" | "committed";

type VisualMoveJournalPayload = {
    sourceDirectory: string;
    targetDirectory: string;
    targetExisted: boolean;
    sendDataPath: string;
    sendDataBackedUp: boolean;
};

/** 只读预检：返回移动影响摘要和 revision，不修改任何文件。 */
export async function previewVisualMove(projectRoot: string, request: MoveCharacterVisualRequest): Promise<MoveCharacterVisualPreview> {
    await assertMoveRequest(projectRoot, request);
    const plan = await buildVisualMovePlan(projectRoot, request);
    const sendData = await readMigrationSendData(projectRoot);
    return {
        revision: computeMoveRevision(plan, await readRawGroups(projectRoot), sendData),
        source: {groupId: request.sourceGroupId, characterId: request.sourceCharacterId, visualId: request.sourceVisualId},
        targetGroupId: request.targetGroupId,
        sourceWillLoseCharacter: plan.sourceWillLoseCharacter,
        sourceNeedsActiveFallback: plan.sourceNeedsActiveFallback,
        targetCharacterExists: plan.targetCharacterExists,
        equivalentTargetRef: plan.equivalentTargetRef,
        equivalentTargetConflict: plan.equivalentTargetConflict,
        fileNameConflict: plan.fileNameRenamed,
        visualIdConflict: plan.visualIdChanged,
        managedReferenceCount: plan.managedReferenceCount,
        sourceActive: plan.sourceManifest.activeVisualId === request.sourceVisualId,
        sourceFileCount: plan.sourceManifest.visuals.length,
    };
}

/**
 * 在 Project 写锁与事务内执行移动：来源删除所选视觉，目标接收为新的生效版本，
 * 等价内容合并到目标已有 ref，受管发送数据引用同步更新。任一步失败完整回滚。
 */
export async function commitVisualMove(
    projectRoot: string,
    request: MoveCharacterVisualRequest,
    options: VisualMoveDependencies = {},
): Promise<MoveCharacterVisualResult> {
    await assertMoveRequest(projectRoot, request);
    return withGroupMigrationLock(projectRoot, async () => {
        const plan = await buildVisualMovePlan(projectRoot, request);
        if (request.expectedUpdatedAt && plan.sourceEntry.updatedAt !== request.expectedUpdatedAt) {
            throw new VisualMoveStaleSourceError();
        }
        if (request.expectedPreviewRevision) {
            const revision = computeMoveRevision(plan, await readRawGroups(projectRoot), await readMigrationSendData(projectRoot));
            if (revision !== request.expectedPreviewRevision) {
                throw new VisualMoveRevisionConflictError();
            }
        }
        if (plan.equivalentTargetConflict) {
            throw new VisualMoveEquivalentConflictError();
        }
        await injectFailure(options.failAt, "stage");

        const transactionId = newTransactionId();
        const transactionRoot = transactionDirectoryRoot(projectRoot);
        await fs.mkdir(transactionRoot, {recursive: true});
        const transactionDirectory = path.join(transactionRoot, transactionId);
        const backupDirectory = path.join(transactionDirectory, "backup");
        const log: VisualMoveJournalPayload = {
            sourceDirectory: characterDirectory(projectRoot, request.sourceGroupId, request.sourceCharacterId),
            targetDirectory: characterDirectory(projectRoot, request.targetGroupId, request.sourceCharacterId),
            targetExisted: plan.targetCharacterExists,
            sendDataPath: sendDataPath(projectRoot),
            sendDataBackedUp: false,
        };
        let logState: VisualMoveJournalState = "preparing";
        const writeLog = (state: VisualMoveJournalState): Promise<void> => {
            logState = state;
            return writeJournal(projectRoot, transactionId, state, log);
        };

        try {
            await fs.mkdir(backupDirectory, {recursive: true});
            await writeLog("preparing");
            // 备份：来源角色目录、目标角色目录与发送数据。
            if (await pathExists(log.sourceDirectory)) {
                await copyDirectory(log.sourceDirectory, path.join(backupDirectory, "source"));
            }
            if (log.targetExisted) {
                await copyDirectory(log.targetDirectory, path.join(backupDirectory, "target"));
            }
            if (await pathExists(log.sendDataPath)) {
                await fs.copyFile(log.sendDataPath, path.join(backupDirectory, SEND_DATA_FILE));
                log.sendDataBackedUp = true;
            }
            await writeLog("backed-up");
            await injectFailure(options.failAt, "backup");

            const now = new Date().toISOString();
            if (!plan.equivalentTargetRef) {
                // 目标：写入移动文件（visualId 冲突时改写内容中的 visualId）并合并 manifest。
                await fs.mkdir(log.targetDirectory, {recursive: true});
                const sourceBytes = await fs.readFile(path.join(log.sourceDirectory, plan.sourceEntry.fileName));
                if (plan.visualIdChanged) {
                    const rewritten = renderCharacterVisualJson({...plan.sourceVisual, visualId: plan.nextVisualId});
                    await fs.writeFile(path.join(log.targetDirectory, plan.targetFileName), rewritten, "utf8");
                } else {
                    await fs.writeFile(path.join(log.targetDirectory, plan.targetFileName), sourceBytes);
                }
                const targetManifest = plan.targetManifest ?? {
                    schema: "nbook.character-visual-collection/v1",
                    characterId: request.sourceCharacterId,
                    activeVisualId: null,
                    visuals: [],
                };
                targetManifest.visuals.push({
                    visualId: plan.nextVisualId,
                    fileName: plan.targetFileName,
                    createdAt: plan.sourceEntry.createdAt,
                    updatedAt: now,
                    source: plan.sourceEntry.source,
                });
                targetManifest.activeVisualId = plan.nextVisualId;
                await writeJsonAtomic(path.join(log.targetDirectory, MANIFEST_FILE), targetManifest);
            } else {
                // 等价合并：目标已有相同内容时复用已有 ref，并把目标生效项切换为等价视觉。
                // 不能只返回“已生效”而让磁盘 manifest 继续指向另一份视觉。
                const targetManifest = plan.targetManifest ?? {
                    schema: "nbook.character-visual-collection/v1",
                    characterId: request.sourceCharacterId,
                    activeVisualId: null,
                    visuals: [],
                };
                targetManifest.activeVisualId = plan.equivalentTargetRef!.visualId;
                await writeJsonAtomic(path.join(log.targetDirectory, MANIFEST_FILE), targetManifest);
            }
            await injectFailure(options.failAt, "commit_files");

            // 来源：移除所选视觉；最后一份时删除整个角色目录，否则删除精确来源文件并写回 fallback manifest。
            if (plan.sourceManifest.visuals.length <= 1) {
                await fs.rm(log.sourceDirectory, {recursive: true, force: true});
            } else {
                plan.sourceManifest.visuals = plan.sourceManifest.visuals.filter((visual) => visual.visualId !== request.sourceVisualId);
                plan.sourceManifest.activeVisualId = plan.fallbackActiveVisualId;
                await writeJsonAtomic(path.join(log.sourceDirectory, MANIFEST_FILE), plan.sourceManifest);
                // 多版本来源必须删除精确来源物理 JSON，避免留下 manifest 不再引用的孤儿文件；
                // 备份目录保留完整来源，失败回滚时原字节恢复。
                await fs.rm(path.join(log.sourceDirectory, plan.sourceEntry.fileName), {force: true});
            }

            // 受管引用：角色/服装固定发送引用按旧 ref 映射到目标 ref。
            const updatedManagedReferenceCount = await migrateSendDataReferences(projectRoot, request, plan);
            await injectFailure(options.failAt, "commit_refs");
            await injectFailure(options.failAt, "crash");

            await verifyMoveResult(projectRoot, request, plan);
            await injectFailure(options.failAt, "verify");
            await writeLog("files-committed");

            await writeLog("committed");
            await fs.rm(transactionDirectory, {recursive: true, force: true});
            await removeTransactionJournal(projectRoot, transactionId);

            const visual = plan.visualIdChanged
                ? {...plan.sourceVisual, visualId: plan.nextVisualId}
                : plan.sourceVisual;
            return {
                mode: plan.equivalentTargetRef ? "merged-equivalent" : "moved",
                ref: {
                    groupId: request.targetGroupId,
                    characterId: request.sourceCharacterId,
                    visualId: plan.equivalentTargetRef?.visualId ?? plan.nextVisualId,
                },
                info: {
                    visualId: plan.equivalentTargetRef?.visualId ?? plan.nextVisualId,
                    fileName: plan.equivalentTargetRef ? (plan.targetManifest?.visuals.find((item) => item.visualId === plan.equivalentTargetRef!.visualId)?.fileName ?? plan.sourceEntry.fileName) : plan.targetFileName,
                    createdAt: plan.equivalentTargetRef ? (plan.targetManifest?.visuals.find((item) => item.visualId === plan.equivalentTargetRef!.visualId)?.createdAt ?? plan.sourceEntry.createdAt) : plan.sourceEntry.createdAt,
                    updatedAt: now,
                    source: plan.equivalentTargetRef ? (plan.targetManifest?.visuals.find((item) => item.visualId === plan.equivalentTargetRef!.visualId)?.source ?? plan.sourceEntry.source) : plan.sourceEntry.source,
                    active: true,
                },
                visual,
                sourceCharacterRemoved: plan.sourceWillLoseCharacter,
                updatedManagedReferenceCount,
            };
        } catch (error) {
            if (error instanceof CrashSimulationError) {
                // 模拟进程中断：跳过回滚，留下日志与备份供下一次 ensure() 恢复。
                throw error;
            }
            await rollbackVisualMove(projectRoot, transactionId, log, transactionDirectory);
            throw error;
        }
    }, options);
}

/**
 * 视觉移动事务的单条恢复入口：由统一恢复调度器按 kind 分派，
 * 只处理自己 kind 的日志；committed 状态只做收尾清理。
 */
export async function recoverVisualMoveJournal(
    projectRoot: string,
    envelope: TransactionJournalEnvelope,
): Promise<void> {
    if (envelope.kind !== JOURNAL_KIND) {
        throw new Error(`视觉移动恢复器收到非法事务种类：${envelope.kind}`);
    }
    const payload = envelope.payload as unknown as VisualMoveJournalPayload;
    const transactionDirectory = path.join(transactionDirectoryRoot(projectRoot), envelope.transactionId);
    if (envelope.state === "committed") {
        await fs.rm(transactionDirectory, {recursive: true, force: true});
        await removeTransactionJournal(projectRoot, envelope.transactionId);
        return;
    }
    await rollbackVisualMove(projectRoot, envelope.transactionId, payload, transactionDirectory);
}

async function assertMoveRequest(projectRoot: string, request: MoveCharacterVisualRequest): Promise<void> {
    if (request.sourceGroupId === request.targetGroupId) {
        throw new VisualMoveInvalidTargetError("目标分组必须与来源分组不同");
    }
    const groups = await readRawGroups(projectRoot);
    if (!groups.groups.some((group) => group.groupId === request.targetGroupId)) {
        throw new VisualMoveInvalidTargetError(`未找到目标分组“${request.targetGroupId}”`);
    }
    if (!groups.groups.some((group) => group.groupId === request.sourceGroupId)) {
        throw new VisualMoveInvalidTargetError(`未找到来源分组“${request.sourceGroupId}”`);
    }
}

async function buildVisualMovePlan(projectRoot: string, request: MoveCharacterVisualRequest): Promise<VisualMovePlan> {
    const sourceDirectory = characterDirectory(projectRoot, request.sourceGroupId, request.sourceCharacterId);
    const sourceManifest = await readManifest(sourceDirectory);
    if (!sourceManifest) throw new VisualMoveInvalidTargetError("未找到要移动的来源角色视觉资料");
    const sourceEntry = sourceManifest.visuals.find((visual) => visual.visualId === request.sourceVisualId);
    if (!sourceEntry) throw new VisualMoveInvalidTargetError("未找到要移动的视觉资料版本");
    const sourceVisual = await readVisualFile(path.join(sourceDirectory, sourceEntry.fileName));
    if (!sourceVisual) throw new VisualMoveInvalidTargetError("要移动的视觉 JSON 无法解析，请先修复后再移动");

    const targetDirectory = characterDirectory(projectRoot, request.targetGroupId, request.sourceCharacterId);
    const targetManifest = await readManifest(targetDirectory);
    const targetCharacterExists = Boolean(targetManifest && targetManifest.visuals.length > 0);

    const contentHash = hashVisualContent(sourceVisual);
    const equivalents = new Map<string, Manifest["visuals"][number]>();
    for (const visual of targetManifest?.visuals ?? []) {
        const file = await readVisualFile(path.join(targetDirectory, visual.fileName));
        if (!file) continue;
        if (hashVisualContent(file) === contentHash) {
            equivalents.set(visual.visualId, visual);
        }
    }
    const equivalentTargetRef = equivalents.size === 1
        ? {groupId: request.targetGroupId, characterId: request.sourceCharacterId, visualId: [...equivalents.keys()][0]!}
        : null;
    const equivalentTargetConflict = equivalents.size > 1;

    const occupiedFileNames = new Set<string>();
    const occupiedVisualIds = new Set<string>();
    for (const visual of targetManifest?.visuals ?? []) {
        occupiedFileNames.add(visual.fileName.toLocaleLowerCase());
        occupiedVisualIds.add(visual.visualId);
    }
    for (const file of await readDirectoryEntries(targetDirectory)) {
        if (file.isFile()) occupiedFileNames.add(file.name.toLocaleLowerCase());
    }
    const fileNameConflict = occupiedFileNames.has(sourceEntry.fileName.toLocaleLowerCase());
    const targetFileName = fileNameConflict
        ? allocateMovedFileName(sourceEntry.fileName, occupiedFileNames, `${request.sourceCharacterId}\u0000${request.sourceVisualId}`)
        : sourceEntry.fileName;
    const visualIdConflict = occupiedVisualIds.has(request.sourceVisualId);
    const nextVisualId = visualIdConflict
        ? deterministicUuid(`${request.sourceCharacterId}\u0000${request.sourceVisualId}`)
        : request.sourceVisualId;

    const remainingValid = await Promise.all(sourceManifest.visuals
        .filter((visual) => visual.visualId !== request.sourceVisualId)
        .map(async (visual) => ({visual, file: await readVisualFile(path.join(sourceDirectory, visual.fileName))})));
    const validRemaining = remainingValid.filter((item) => item.file !== null);
    const fallbackActiveVisualId = validRemaining.length > 0
        ? [...validRemaining].sort((left, right) => (
            right.visual.updatedAt.localeCompare(left.visual.updatedAt)
            || left.visual.visualId.localeCompare(right.visual.visualId)
        ))[0]!.visual.visualId
        : null;

    return {
        sourceManifest,
        targetManifest,
        targetCharacterExists,
        sourceEntry,
        sourceVisual,
        contentHash,
        equivalentTargetRef,
        equivalentTargetConflict,
        targetFileName,
        nextVisualId,
        fileNameRenamed: fileNameConflict,
        visualIdChanged: visualIdConflict,
        managedReferenceCount: countManagedReferences(await readMigrationSendData(projectRoot), request),
        sourceWillLoseCharacter: sourceManifest.visuals.length <= 1,
        sourceNeedsActiveFallback: sourceManifest.activeVisualId === request.sourceVisualId && sourceManifest.visuals.length > 1,
        fallbackActiveVisualId,
    };
}

function computeMoveRevision(plan: VisualMovePlan, groups: unknown, sendData: unknown): string {
    return createHash("sha256").update(JSON.stringify({
        sourceManifest: plan.sourceManifest,
        targetManifest: plan.targetManifest,
        sourceEntry: plan.sourceEntry,
        contentHash: plan.contentHash,
        groups,
        sendData: sendData ?? null,
    })).digest("hex");
}

/** 内容指纹：忽略 visualId、文件名、manifest 时间戳和来源字段。 */
function hashVisualContent(visual: CharacterVisualFile): string {
    const {visualId: _visualId, ...content} = visual;
    return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

async function migrateSendDataReferences(
    projectRoot: string,
    request: MoveCharacterVisualRequest,
    plan: VisualMovePlan,
): Promise<number> {
    const managedPath = sendDataPath(projectRoot);
    if (!await pathExists(managedPath)) return 0;
    const raw = JSON.parse(await fs.readFile(managedPath, "utf8")) as Record<string, unknown>;
    let updated = 0;
    const rewrite = (list: unknown): void => {
        if (!Array.isArray(list)) return;
        for (const item of list) {
            if (typeof item !== "object" || item === null) continue;
            const record = item as Record<string, unknown>;
            if (record.groupId === request.sourceGroupId && record.visualId === request.sourceVisualId) {
                record.groupId = request.targetGroupId;
                record.visualId = plan.equivalentTargetRef?.visualId ?? plan.nextVisualId;
                updated += 1;
            }
        }
    };
    rewrite(raw.characterSelections);
    rewrite(raw.outfitSelections);
    if (Array.isArray(raw.characterSelections)) {
        const characterIds = [...new Set((raw.characterSelections as Array<Record<string, unknown>>).map((item) => item.characterId).filter((id): id is string => typeof id === "string"))];
        raw.characterIds = characterIds;
    }
    await writeJsonAtomic(managedPath, raw);
    return updated;
}

async function verifyMoveResult(
    projectRoot: string,
    request: MoveCharacterVisualRequest,
    plan: VisualMovePlan,
): Promise<void> {
    if (plan.equivalentTargetRef) {
        const targetDirectory = characterDirectory(projectRoot, request.targetGroupId, request.sourceCharacterId);
        const target = await readVisualFile(path.join(targetDirectory, plan.targetManifest?.visuals.find((item) => item.visualId === plan.equivalentTargetRef!.visualId)?.fileName ?? plan.sourceEntry.fileName));
        if (!target || hashVisualContent(target) !== plan.contentHash) {
            throw new Error("移动校验失败：目标等价视觉内容不一致");
        }
        // 等价合并必须把目标 manifest 生效项切换到复用的等价视觉。
        const manifest = await readManifest(targetDirectory);
        if (manifest?.activeVisualId !== plan.equivalentTargetRef.visualId) {
            throw new Error("移动校验失败：等价合并后目标生效项未切换");
        }
    } else {
        const target = await readVisualFile(path.join(characterDirectory(projectRoot, request.targetGroupId, request.sourceCharacterId), plan.targetFileName));
        if (!target || hashVisualContent(target) !== plan.contentHash) {
            throw new Error("移动校验失败：目标视觉内容不一致");
        }
        if (target.visualId !== plan.nextVisualId) {
            throw new Error("移动校验失败：目标视觉 ID 不一致");
        }
        const manifest = await readManifest(characterDirectory(projectRoot, request.targetGroupId, request.sourceCharacterId));
        const ids = new Set<string>();
        for (const visual of manifest?.visuals ?? []) {
            if (ids.has(visual.visualId)) throw new Error("移动校验失败：目标 manifest 存在重复视觉 ID");
            ids.add(visual.visualId);
        }
    }
    // 来源 manifest：要么整个目录消失，要么不再包含所选视觉。
    const sourceDirectory = characterDirectory(projectRoot, request.sourceGroupId, request.sourceCharacterId);
    if (await pathExists(sourceDirectory)) {
        const sourceManifest = await readManifest(sourceDirectory);
        if (sourceManifest?.visuals.some((visual) => visual.visualId === request.sourceVisualId)) {
            throw new Error("移动校验失败：来源 manifest 仍保留所选视觉");
        }
        // 多版本来源必须物理删除精确来源 JSON，不允许遗留孤儿文件。
        if (await pathExists(path.join(sourceDirectory, plan.sourceEntry.fileName))) {
            throw new Error("移动校验失败：来源物理 JSON 仍然存在");
        }
    }
    // 照片路径必须在 Project 允许位置内；不复制、不删除照片资产。
    for (const photo of plan.sourceVisual.photos) {
        resolveTextToImageAssetPath(projectRoot, photo);
    }
}

async function rollbackVisualMove(
    projectRoot: string,
    transactionId: string,
    log: VisualMoveJournalPayload,
    transactionDirectory: string,
): Promise<void> {
    try {
        const backupDirectory = path.join(transactionDirectory, "backup");
        await fs.rm(log.sourceDirectory, {recursive: true, force: true});
        await fs.rm(log.targetDirectory, {recursive: true, force: true});
        if (await pathExists(path.join(backupDirectory, "source"))) {
            await copyDirectory(path.join(backupDirectory, "source"), log.sourceDirectory);
        }
        if (log.targetExisted && await pathExists(path.join(backupDirectory, "target"))) {
            await copyDirectory(path.join(backupDirectory, "target"), log.targetDirectory);
        }
        if (log.sendDataBackedUp && await pathExists(path.join(backupDirectory, SEND_DATA_FILE))) {
            await fs.mkdir(path.dirname(log.sendDataPath), {recursive: true});
            await fs.copyFile(path.join(backupDirectory, SEND_DATA_FILE), log.sendDataPath);
        }
    } finally {
        await fs.rm(transactionDirectory, {recursive: true, force: true});
        await removeTransactionJournal(projectRoot, transactionId);
    }
}

function transactionDirectoryRoot(projectRoot: string): string {
    return transactionJournalRoot(projectRoot);
}

function characterDirectory(projectRoot: string, groupId: string, characterId: string): string {
    return path.join(projectRoot, LIBRARY_DIRECTORY, GROUP_DIRECTORY, groupId, characterId);
}

function sendDataPath(projectRoot: string): string {
    return path.join(projectRoot, ".nbook", SEND_DATA_FILE);
}

async function readRawGroups(projectRoot: string): Promise<{groups: Array<{groupId: string}>}> {
    return readMigrationGroups(projectRoot);
}

function countManagedReferences(sendData: unknown, request: MoveCharacterVisualRequest): number {
    if (typeof sendData !== "object" || sendData === null) return 0;
    const record = sendData as Record<string, unknown>;
    const count = (list: unknown): number => (Array.isArray(list) ? list.filter((item) => (
        typeof item === "object" && item !== null
        && "groupId" in item && (item as Record<string, unknown>).groupId === request.sourceGroupId
        && "visualId" in item && (item as Record<string, unknown>).visualId === request.sourceVisualId
    )).length : 0);
    return count(record.characterSelections) + count(record.outfitSelections);
}

async function readManifest(directory: string): Promise<Manifest | null> {
    try {
        const raw = JSON.parse(await fs.readFile(path.join(directory, MANIFEST_FILE), "utf8")) as Partial<Manifest>;
        if (!Array.isArray(raw.visuals)) return null;
        return {
            schema: "nbook.character-visual-collection/v1",
            characterId: typeof raw.characterId === "string" ? raw.characterId : "",
            activeVisualId: typeof raw.activeVisualId === "string" ? raw.activeVisualId : null,
            visuals: raw.visuals.filter((item): item is Manifest["visuals"][number] => (
                typeof item === "object" && item !== null
                && typeof (item as Record<string, unknown>).visualId === "string"
                && typeof (item as Record<string, unknown>).fileName === "string"
                && typeof (item as Record<string, unknown>).createdAt === "string"
                && typeof (item as Record<string, unknown>).updatedAt === "string"
                && ((item as Record<string, unknown>).source === "manual"
                    || (item as Record<string, unknown>).source === "llm"
                    || (item as Record<string, unknown>).source === "migration"
                    || (item as Record<string, unknown>).source === "copy")
            )),
        };
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return null;
        throw error;
    }
}

async function readVisualFile(filePath: string): Promise<CharacterVisualFile | null> {
    try {
        return parseCharacterVisualJson(await fs.readFile(filePath, "utf8"));
    } catch {
        return null;
    }
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

function deterministicSuffix(input: string): string {
    return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 8);
}

function deterministicUuid(input: string): string {
    const digest = createHash("sha256").update(input, "utf8").digest();
    digest[6] = (digest[6]! & 0x0f) | 0x40;
    digest[8] = (digest[8]! & 0x3f) | 0x80;
    const hex = digest.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function copyDirectory(source: string, target: string): Promise<void> {
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.cp(source, target, {recursive: true, force: true});
}

async function writeJournal(
    projectRoot: string,
    transactionId: string,
    state: VisualMoveJournalState,
    payload: VisualMoveJournalPayload,
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

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (isErrorCode(error, "ENOENT")) return false;
        throw error;
    }
}

class CrashSimulationError extends Error {
    constructor() {
        super("模拟进程中断：crash");
        this.name = "CrashSimulationError";
    }
}

async function injectFailure(failAt: VisualMoveDependencies["failAt"] | undefined, stage: NonNullable<VisualMoveDependencies["failAt"]>): Promise<void> {
    if (failAt !== stage) return;
    if (stage === "crash") throw new CrashSimulationError();
    throw new Error(`故障注入：${stage}`);
}

function isErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
