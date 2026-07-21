import {randomUUID} from "node:crypto";
import {z} from "zod";
import {
    Prisma,
    type PrismaClient,
    type TextToImageDispatchPreparation,
} from "nbook/server/generated/prisma/client";
import {lockDatabaseKey} from "nbook/server/database/locks";
import {
    DispatchPreparationStampSchema,
    DispatchPreparationSnapshotSchema,
    type DispatchPreparationSnapshot,
    type DispatchPreparationStamp,
} from "nbook/shared/text-to-image-dispatch";
import {IllustrationExecutionRegistrationReceiptSchema} from "nbook/shared/text-to-image-execution";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import type {
    IllustrationRegistrationPreparationPort,
    PreparedDispatchBatch,
} from "nbook/server/text-to-image/illustration-registration.coordinator";
import type {DispatchReconcilerPreparationPort} from "nbook/server/text-to-image/dispatch-reconciler";

const StableIdSchema = z.string().trim().min(1).max(200);
const ProjectPathSchema = z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u);
const PreparedBatchSchema = z.object({
    preparationId: StableIdSchema,
    manifestId: StableIdSchema,
    manifestHash: TextToImageContractHashSchema,
    approvalId: StableIdSchema,
    approvalHash: TextToImageContractHashSchema,
    ownerUserId: z.number().int().positive().safe(),
    providerId: z.number().int().positive().safe(),
    providerCredentialRevision: z.number().int().positive().safe(),
    projectId: StableIdSchema,
    projectPath: ProjectPathSchema,
    jobs: z.array(z.object({
        id: StableIdSchema,
        dispatchKey: TextToImageContractHashSchema,
    }).strict()).min(1).max(32),
}).strict().superRefine((batch, context) => {
    if (new Set(batch.jobs.map((job) => job.id)).size !== batch.jobs.length
        || new Set(batch.jobs.map((job) => job.dispatchKey)).size !== batch.jobs.length) {
        context.addIssue({code: "custom", path: ["jobs"], message: "jobId/dispatchKey 必须分别唯一"});
    }
});

const StableIdListSchema = z.array(StableIdSchema).min(1).max(32);
const DispatchKeyListSchema = z.array(TextToImageContractHashSchema).min(1).max(32);
const StableErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,119}$/u);

export type DispatchPreparationErrorCode =
    | "TEXT_TO_IMAGE_PROVIDER_NOT_CONFIGURED"
    | "TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE"
    | "TEXT_TO_IMAGE_DISPATCH_PREPARATION_CONFLICT"
    | "TEXT_TO_IMAGE_DISPATCH_PREPARATION_QUARANTINED";

/** App preparation 的稳定错误出口；调用方不得靠字符串猜测是否可重试。 */
export class DispatchPreparationError extends Error {
    constructor(readonly code: DispatchPreparationErrorCode, message: string) {
        super(`${code}: ${message}`);
        this.name = "DispatchPreparationError";
    }
}

type RepositoryOptions = {
    clock?: () => Date;
    attemptFactory?: () => string;
    leaseMs?: number;
};

class PreparationCasRejected extends Error {}

/** App SQLite 中跨库 preparation/items 的唯一写入口。 */
export class PrismaDispatchPreparationRepository implements IllustrationRegistrationPreparationPort, DispatchReconcilerPreparationPort {
    private readonly clock: () => Date;
    private readonly attemptFactory: () => string;
    private readonly leaseMs: number;

    constructor(
        private readonly client: PrismaClient,
        options: RepositoryOptions = {},
    ) {
        this.clock = options.clock ?? (() => new Date());
        this.attemptFactory = options.attemptFactory ?? (() => `prepare-${randomUUID()}`);
        this.leaseMs = z.number().int().min(5_000).max(300_000).parse(options.leaseMs ?? 30_000);
    }

    /** 校验 singleton Provider/revision 后，全有或全无地建立 inert batch。 */
    async prepare(batchInput: PreparedDispatchBatch): Promise<DispatchPreparationStamp> {
        const batch = PreparedBatchSchema.parse(batchInput);
        const now = this.validNow();
        const attemptId = StableIdSchema.parse(this.attemptFactory());
        return await this.client.$transaction(async (transaction) => {
            await lockDatabaseKey(transaction, batch.ownerUserId);
            await this.assertProvider(transaction, batch);
            const existing = await transaction.textToImageDispatchPreparation.findUnique({where: {id: batch.preparationId}});
            if (existing) {
                await this.assertExistingClosure(transaction, existing, batch);
                if (existing.state === "quarantined") {
                    throw new DispatchPreparationError(
                        "TEXT_TO_IMAGE_DISPATCH_PREPARATION_QUARANTINED",
                        existing.quarantineMessage ?? "Dispatch preparation 已隔离",
                    );
                }
                if (existing.state === "abandoned") {
                    const prepareVersion = existing.prepareVersion + 1;
                    const prepareLeaseUntil = new Date(now.getTime() + this.leaseMs);
                    const updated = await transaction.textToImageDispatchPreparation.updateMany({
                        where: {id: existing.id, state: "abandoned", prepareVersion: existing.prepareVersion},
                        data: {
                            prepareAttemptId: attemptId,
                            prepareLeaseUntil,
                            prepareVersion,
                            stateVersion: {increment: 1},
                            state: "prepared",
                            quarantineCode: null,
                            quarantineMessage: null,
                        },
                    });
                    if (updated.count !== 1) throw new PreparationCasRejected();
                    const items = await transaction.textToImageProviderLaneItem.updateMany({
                        where: {preparationId: existing.id, prepareVersion: existing.prepareVersion, state: "prepared"},
                        data: {
                            prepareAttemptId: attemptId,
                            prepareVersion,
                            stateVersion: {increment: 1},
                        },
                    });
                    if (items.count !== batch.jobs.length) throw new PreparationCasRejected();
                    return DispatchPreparationStampSchema.parse({
                        preparationId: existing.id,
                        prepareAttemptId: attemptId,
                        prepareLeaseUntil: prepareLeaseUntil.toISOString(),
                        prepareVersion,
                    });
                }
                return stampFromRecord(existing);
            }
            const manifestConflict = await transaction.textToImageDispatchPreparation.findUnique({
                where: {manifestHash: batch.manifestHash},
                select: {id: true},
            });
            if (manifestConflict) throw preparationConflict("Manifest 已绑定另一组 dispatch closure");
            const dispatchConflict = await transaction.textToImageProviderLaneItem.findFirst({
                where: {dispatchKey: {in: batch.jobs.map((job) => job.dispatchKey)}},
                select: {dispatchKey: true},
            });
            if (dispatchConflict) throw preparationConflict("dispatchKey 已被另一 preparation 占用");
            const prepareLeaseUntil = new Date(now.getTime() + this.leaseMs);
            await transaction.textToImageDispatchPreparation.create({
                data: {
                    id: batch.preparationId,
                    manifestHash: batch.manifestHash,
                    ownerUserId: batch.ownerUserId,
                    providerId: batch.providerId,
                    providerCredentialRevision: batch.providerCredentialRevision,
                    projectId: batch.projectId,
                    projectPath: batch.projectPath,
                    prepareAttemptId: attemptId,
                    prepareLeaseUntil,
                    prepareVersion: 1,
                    stateVersion: 1,
                    state: "prepared",
                    jobIdsJson: JSON.stringify(batch.jobs.map((job) => job.id)),
                    dispatchKeysJson: JSON.stringify(batch.jobs.map((job) => job.dispatchKey)),
                    laneItems: {
                        create: batch.jobs.map((job) => ({
                            dispatchKey: job.dispatchKey,
                            jobId: job.id,
                            ownerUserId: batch.ownerUserId,
                            providerId: batch.providerId,
                            providerCredentialRevision: batch.providerCredentialRevision,
                            projectId: batch.projectId,
                            projectPath: batch.projectPath,
                            manifestHash: batch.manifestHash,
                            prepareAttemptId: attemptId,
                            prepareVersion: 1,
                            state: "prepared",
                            stateVersion: 1,
                        })),
                    },
                },
            });
            return DispatchPreparationStampSchema.parse({
                preparationId: batch.preparationId,
                prepareAttemptId: attemptId,
                prepareLeaseUntil: prepareLeaseUntil.toISOString(),
                prepareVersion: 1,
            });
        });
    }

    /** 只接受与 App closure 完全相等的 Project receipt。 */
    async projectCommitted(stampInput: DispatchPreparationStamp, receiptInput: unknown): Promise<boolean> {
        const stamp = DispatchPreparationStampSchema.parse(stampInput);
        const receipt = IllustrationExecutionRegistrationReceiptSchema.parse(receiptInput);
        try {
            return await this.client.$transaction(async (transaction) => {
                const preparation = await transaction.textToImageDispatchPreparation.findUnique({where: {id: stamp.preparationId}});
                if (!preparation || !sameStamp(preparation, stamp) || !receiptMatches(preparation, receipt)) return false;
                await lockDatabaseKey(transaction, preparation.ownerUserId);
                if (preparation.state === "ready" || preparation.state === "project_committed") return true;
                if (preparation.state !== "prepared") return false;
                const updated = await transaction.textToImageDispatchPreparation.updateMany({
                    where: {
                        id: preparation.id,
                        prepareAttemptId: stamp.prepareAttemptId,
                        prepareVersion: stamp.prepareVersion,
                        stateVersion: preparation.stateVersion,
                        state: "prepared",
                    },
                    data: {state: "project_committed", stateVersion: {increment: 1}},
                });
                if (updated.count !== 1) throw new PreparationCasRejected();
                return true;
            });
        } catch (error) {
            if (error instanceof PreparationCasRejected) return false;
            throw error;
        }
    }

    /** 把整批 prepared items 与 preparation 在同一 App 事务中提升为 ready。 */
    async ready(stampInput: DispatchPreparationStamp, receiptInput: unknown): Promise<boolean> {
        const stamp = DispatchPreparationStampSchema.parse(stampInput);
        const receipt = IllustrationExecutionRegistrationReceiptSchema.parse(receiptInput);
        try {
            return await this.client.$transaction(async (transaction) => {
                const preparation = await transaction.textToImageDispatchPreparation.findUnique({where: {id: stamp.preparationId}});
                if (!preparation || !sameStamp(preparation, stamp) || !receiptMatches(preparation, receipt)) return false;
                await lockDatabaseKey(transaction, preparation.ownerUserId);
                if (preparation.state === "ready") {
                    return await transaction.textToImageProviderLaneItem.count({
                        where: {preparationId: preparation.id, prepareVersion: stamp.prepareVersion, state: "ready"},
                    }) === receipt.jobIds.length;
                }
                if (preparation.state !== "project_committed") return false;
                const items = await transaction.textToImageProviderLaneItem.updateMany({
                    where: {preparationId: preparation.id, prepareVersion: stamp.prepareVersion, state: "prepared"},
                    data: {state: "ready", stateVersion: {increment: 1}},
                });
                if (items.count !== receipt.jobIds.length) throw new PreparationCasRejected();
                const updated = await transaction.textToImageDispatchPreparation.updateMany({
                    where: {id: preparation.id, state: "project_committed", stateVersion: preparation.stateVersion},
                    data: {state: "ready", stateVersion: {increment: 1}},
                });
                if (updated.count !== 1) throw new PreparationCasRejected();
                return true;
            });
        } catch (error) {
            if (error instanceof PreparationCasRejected) return false;
            throw error;
        }
    }

    /** CAS 接管 lease 已过期的 prepared preparation，保持原 attempt/version 以便核对迟到 outbox。 */
    async claimExpired(limitInput: number): Promise<DispatchPreparationSnapshot[]> {
        const limit = z.number().int().min(1).max(100).parse(limitInput);
        const now = this.validNow();
        const candidates = await this.client.textToImageDispatchPreparation.findMany({
            where: {state: "prepared", prepareLeaseUntil: {lte: now}},
            orderBy: [{prepareLeaseUntil: "asc"}, {createdAt: "asc"}],
            take: limit,
        });
        const claimed: DispatchPreparationSnapshot[] = [];
        for (const candidate of candidates) {
            const snapshot = await this.client.$transaction(async (transaction) => {
                await lockDatabaseKey(transaction, candidate.ownerUserId);
                const leaseUntil = new Date(now.getTime() + this.leaseMs);
                const updated = await transaction.textToImageDispatchPreparation.updateMany({
                    where: {
                        id: candidate.id,
                        state: "prepared",
                        stateVersion: candidate.stateVersion,
                        prepareAttemptId: candidate.prepareAttemptId,
                        prepareVersion: candidate.prepareVersion,
                        prepareLeaseUntil: candidate.prepareLeaseUntil,
                    },
                    data: {prepareLeaseUntil: leaseUntil, stateVersion: {increment: 1}},
                });
                if (updated.count !== 1) return null;
                const current = await transaction.textToImageDispatchPreparation.findUniqueOrThrow({where: {id: candidate.id}});
                return await this.readSnapshot(transaction, current);
            });
            if (snapshot) claimed.push(snapshot);
        }
        return claimed;
    }

    /** 精确 projectId 重定位后同步 preparation 与整批 lane item 的 portable path。 */
    async relocate(snapshotInput: DispatchPreparationSnapshot, projectPathInput: string): Promise<DispatchPreparationSnapshot> {
        const snapshot = DispatchPreparationSnapshotSchema.parse(snapshotInput);
        const projectPath = ProjectPathSchema.parse(projectPathInput);
        try {
            return await this.client.$transaction(async (transaction) => {
                await lockDatabaseKey(transaction, snapshot.ownerUserId);
                const items = await transaction.textToImageProviderLaneItem.updateMany({
                    where: {
                        preparationId: snapshot.id,
                        prepareVersion: snapshot.prepareVersion,
                        prepareAttemptId: snapshot.prepareAttemptId,
                        projectPath: snapshot.projectPath,
                    },
                    data: {projectPath, stateVersion: {increment: 1}},
                });
                if (items.count !== snapshot.jobIds.length) throw new PreparationCasRejected();
                const updated = await transaction.textToImageDispatchPreparation.updateMany({
                    where: snapshotCasWhere(snapshot),
                    data: {projectPath, stateVersion: {increment: 1}},
                });
                if (updated.count !== 1) throw new PreparationCasRejected();
                const current = await transaction.textToImageDispatchPreparation.findUniqueOrThrow({where: {id: snapshot.id}});
                return await this.readSnapshot(transaction, current);
            });
        } catch (error) {
            if (error instanceof PreparationCasRejected) throw preparationConflict("Project relocation CAS 已失效");
            throw error;
        }
    }

    /** Reconciler 用当前 claimed stamp 复用注册 promotion 合同。 */
    async promote(
        snapshotInput: DispatchPreparationSnapshot,
        receipt: z.infer<typeof IllustrationExecutionRegistrationReceiptSchema>,
    ): Promise<boolean> {
        const snapshot = DispatchPreparationSnapshotSchema.parse(snapshotInput);
        const stamp = stampFromRecord({
            id: snapshot.id,
            prepareAttemptId: snapshot.prepareAttemptId,
            prepareLeaseUntil: new Date(snapshot.prepareLeaseUntil),
            prepareVersion: snapshot.prepareVersion,
        });
        return await this.projectCommitted(stamp, receipt) && await this.ready(stamp, receipt);
    }

    /** 只有 claimed snapshot 仍精确匹配且 Project 明确无 closure 时才能 abandoned。 */
    async abandon(snapshotInput: DispatchPreparationSnapshot): Promise<boolean> {
        const snapshot = DispatchPreparationSnapshotSchema.parse(snapshotInput);
        const updated = await this.client.textToImageDispatchPreparation.updateMany({
            where: snapshotCasWhere(snapshot),
            data: {state: "abandoned", stateVersion: {increment: 1}},
        });
        return updated.count === 1;
    }

    /** 隔离 preparation 与全部未发送 item；错误证据在两层保持一致。 */
    async quarantine(snapshotInput: DispatchPreparationSnapshot, codeInput: string, messageInput: string): Promise<boolean> {
        const snapshot = DispatchPreparationSnapshotSchema.parse(snapshotInput);
        const code = StableErrorCodeSchema.parse(codeInput);
        const message = z.string().trim().min(1).max(1_000).parse(messageInput);
        try {
            return await this.client.$transaction(async (transaction) => {
                await lockDatabaseKey(transaction, snapshot.ownerUserId);
                const items = await transaction.textToImageProviderLaneItem.updateMany({
                    where: {preparationId: snapshot.id, prepareVersion: snapshot.prepareVersion, state: "prepared"},
                    data: {state: "quarantined", stateVersion: {increment: 1}, errorCode: code, errorMessage: message},
                });
                if (items.count !== snapshot.jobIds.length) throw new PreparationCasRejected();
                const updated = await transaction.textToImageDispatchPreparation.updateMany({
                    where: snapshotCasWhere(snapshot),
                    data: {
                        state: "quarantined",
                        stateVersion: {increment: 1},
                        quarantineCode: code,
                        quarantineMessage: message,
                    },
                });
                if (updated.count !== 1) throw new PreparationCasRejected();
                return true;
            });
        } catch (error) {
            if (error instanceof PreparationCasRejected) return false;
            throw error;
        }
    }

    /** Provider 与 credential revision 必须在同一 owner 写锁内仍是当前 singleton。 */
    private async assertProvider(transaction: Prisma.TransactionClient, batch: PreparedDispatchBatch): Promise<void> {
        const provider = await transaction.textToImageProvider.findFirst({
            where: {id: batch.providerId, ownerUserId: batch.ownerUserId, kind: "novelai"},
            select: {credentialRevision: true, credentialCiphertext: true, credentialIv: true, credentialTag: true},
        });
        if (!provider || !provider.credentialCiphertext || !provider.credentialIv || !provider.credentialTag) {
            throw new DispatchPreparationError("TEXT_TO_IMAGE_PROVIDER_NOT_CONFIGURED", "NovelAI Provider 尚未完整配置");
        }
        if (provider.credentialRevision !== batch.providerCredentialRevision) {
            throw new DispatchPreparationError(
                "TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE",
                "Execution Preview 使用的 Provider credential revision 已过期",
            );
        }
    }

    /** 既有 preparation 只能命中相同 owner/provider/project/job/dispatch closure。 */
    private async assertExistingClosure(
        transaction: Prisma.TransactionClient,
        existing: {
            id: string;
            ownerUserId: number;
            providerId: number;
            providerCredentialRevision: number;
            projectId: string;
            projectPath: string;
            jobIdsJson: string;
            dispatchKeysJson: string;
        },
        batch: PreparedDispatchBatch,
    ): Promise<void> {
        const rawJobIds: unknown = JSON.parse(existing.jobIdsJson);
        const rawDispatchKeys: unknown = JSON.parse(existing.dispatchKeysJson);
        const jobIds = StableIdListSchema.parse(rawJobIds);
        const dispatchKeys = DispatchKeyListSchema.parse(rawDispatchKeys);
        if (existing.ownerUserId !== batch.ownerUserId
            || existing.providerId !== batch.providerId
            || existing.providerCredentialRevision !== batch.providerCredentialRevision
            || existing.projectId !== batch.projectId
            || existing.projectPath !== batch.projectPath
            || !sameList(jobIds, batch.jobs.map((job) => job.id))
            || !sameList(dispatchKeys, batch.jobs.map((job) => job.dispatchKey))) {
            throw preparationConflict("稳定 preparation identity 命中了不同的调度 closure");
        }
        const itemCount = await transaction.textToImageProviderLaneItem.count({where: {preparationId: existing.id}});
        if (itemCount !== batch.jobs.length) throw preparationConflict("既有 preparation 的 lane item 闭包不完整");
    }

    /** 禁止非法测试时钟把不可恢复时间写入持久状态。 */
    private validNow(): Date {
        const now = this.clock();
        if (Number.isNaN(now.getTime())) throw preparationConflict("Preparation 时钟返回非法时间");
        return now;
    }

    /** 把 App DB record 与严格解析的 closure JSON 还原为 reconciler snapshot。 */
    private async readSnapshot(
        transaction: Prisma.TransactionClient,
        record: TextToImageDispatchPreparation,
    ): Promise<DispatchPreparationSnapshot> {
        const rawJobIds: unknown = JSON.parse(record.jobIdsJson);
        const rawDispatchKeys: unknown = JSON.parse(record.dispatchKeysJson);
        const jobIds = StableIdListSchema.parse(rawJobIds);
        const dispatchKeys = DispatchKeyListSchema.parse(rawDispatchKeys);
        const itemCount = await transaction.textToImageProviderLaneItem.count({
            where: {preparationId: record.id, prepareVersion: record.prepareVersion},
        });
        if (itemCount !== jobIds.length) throw preparationConflict("Preparation lane item closure 不完整");
        return DispatchPreparationSnapshotSchema.parse({
            schemaVersion: "nbook.text-to-image-dispatch-preparation/v1",
            id: record.id,
            ownerUserId: record.ownerUserId,
            providerId: record.providerId,
            providerCredentialRevision: record.providerCredentialRevision,
            projectId: record.projectId,
            projectPath: record.projectPath,
            manifestHash: record.manifestHash,
            prepareAttemptId: record.prepareAttemptId,
            prepareLeaseUntil: record.prepareLeaseUntil.toISOString(),
            prepareVersion: record.prepareVersion,
            stateVersion: record.stateVersion,
            state: record.state,
            jobIds,
            dispatchKeys,
            quarantineCode: record.quarantineCode,
            quarantineMessage: record.quarantineMessage,
            createdAt: record.createdAt.toISOString(),
            updatedAt: record.updatedAt.toISOString(),
        });
    }
}

/** 从持久 preparation 重建跨库 stamp。 */
function stampFromRecord(record: {
    id: string;
    prepareAttemptId: string;
    prepareLeaseUntil: Date;
    prepareVersion: number;
}): DispatchPreparationStamp {
    return DispatchPreparationStampSchema.parse({
        preparationId: record.id,
        prepareAttemptId: record.prepareAttemptId,
        prepareLeaseUntil: record.prepareLeaseUntil.toISOString(),
        prepareVersion: record.prepareVersion,
    });
}

/** receipt 必须与 preparation 持久化的 manifest/job/dispatch 闭包完全一致。 */
function receiptMatches(
    preparation: {manifestHash: string; jobIdsJson: string; dispatchKeysJson: string},
    receipt: z.infer<typeof IllustrationExecutionRegistrationReceiptSchema>,
): boolean {
    const rawJobIds: unknown = JSON.parse(preparation.jobIdsJson);
    const rawDispatchKeys: unknown = JSON.parse(preparation.dispatchKeysJson);
    return receipt.executionManifestHash === preparation.manifestHash
        && sameList(receipt.jobIds, StableIdListSchema.parse(rawJobIds))
        && sameList(receipt.dispatchKeys, DispatchKeyListSchema.parse(rawDispatchKeys));
}

/** CAS 必须绑定同一 attempt/version/lease，而不是只按 preparationId 更新。 */
function sameStamp(
    preparation: {id: string; prepareAttemptId: string; prepareLeaseUntil: Date; prepareVersion: number},
    stamp: DispatchPreparationStamp,
): boolean {
    return preparation.id === stamp.preparationId
        && preparation.prepareAttemptId === stamp.prepareAttemptId
        && preparation.prepareVersion === stamp.prepareVersion
        && preparation.prepareLeaseUntil.toISOString() === stamp.prepareLeaseUntil;
}

/** Reconciler mutation 的完整 preparation CAS 条件。 */
function snapshotCasWhere(snapshot: DispatchPreparationSnapshot): Prisma.TextToImageDispatchPreparationWhereInput {
    return {
        id: snapshot.id,
        state: snapshot.state,
        stateVersion: snapshot.stateVersion,
        prepareAttemptId: snapshot.prepareAttemptId,
        prepareVersion: snapshot.prepareVersion,
        prepareLeaseUntil: new Date(snapshot.prepareLeaseUntil),
    };
}

/** 闭包数组顺序也是 outputIndex 的稳定语义。 */
function sameList(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function preparationConflict(message: string): DispatchPreparationError {
    return new DispatchPreparationError("TEXT_TO_IMAGE_DISPATCH_PREPARATION_CONFLICT", message);
}
