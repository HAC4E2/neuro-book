import {randomUUID} from "node:crypto";
import {z} from "zod";
import {Prisma, type PrismaClient, type TextToImageProviderLaneItem} from "nbook/server/generated/prisma/client";
import {lockDatabaseKey} from "nbook/server/database/locks";
import {
    ProviderLaneItemSnapshotSchema,
    type ProviderLaneItemSnapshot,
} from "nbook/shared/text-to-image-dispatch";
import {TextToImageProviderSettingsSchema} from "nbook/server/text-to-image/schemas";
import {
    openTextToImageCredential,
    type SealedCredential,
} from "nbook/server/text-to-image/provider-credential";
import {createProviderRevisionInvalidationId} from "nbook/server/text-to-image/provider-revision-invalidation";

const StableIdSchema = z.string().trim().min(1).max(200);
const StableErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,119}$/u);
const RetryableNovelAiErrorCodeSchema = z.string().regex(/^NOVELAI_HTTP_(?:429|5\d\d)$/u);
const CandidateRowsSchema = z.array(z.object({dispatchKey: z.string().regex(/^sha256:[a-f0-9]{64}$/u)}).strict()).max(100);
const MINIMUM_NOVELAI_INTERVAL_MS = 15_000;
const OUTCOME_UNKNOWN_MESSAGE = "持久化 attempt 已开始，但 lease 到期后无法确认远端结果；系统不会自动重试。";

type RepositoryOptions = {
    clock?: () => Date;
    claimFactory?: () => string;
    attemptFactory?: () => string;
    claimLeaseMs?: number;
    sendLeaseMs?: number;
    /** 测试可注入确定性 opener；生产实现只在 owner transaction 内返回一次性明文。 */
    credentialOpener?: (credential: SealedCredential) => Promise<string>;
};

export type ProviderLaneRecoveryResult = {
    leasedRecovered: number;
    attemptsRetried: number;
    attemptsUnknown: number;
};

export type ExpiredAttemptResolution =
    | {kind: "completed"}
    | {kind: "retryable"; code: string; message: string}
    | {kind: "failed"; code: string; message: string}
    | {kind: "outcome_unknown"; message: string};

/** attempt_started 与本次请求凭据在同一 owner lock 中形成的内存闭包。 */
export type ProviderLaneAttemptStart =
    | {kind: "started"; item: ProviderLaneItemSnapshot; credential: string}
    | {kind: "configuration_error"; item: ProviderLaneItemSnapshot; code: string; message: string};

export type ProviderLaneRetryOutcome = "retry_wait" | "configuration_stale" | null;

class ProviderLaneCasRejected extends Error {}

/** App SQLite 中唯一的 persistent Provider lane 状态机。 */
export class ProviderLaneRepository {
    private readonly clock: () => Date;
    private readonly claimFactory: () => string;
    private readonly attemptFactory: () => string;
    private readonly claimLeaseMs: number;
    private readonly sendLeaseMs: number;
    private readonly credentialOpener: (credential: SealedCredential) => Promise<string>;

    constructor(
        private readonly client: PrismaClient,
        options: RepositoryOptions = {},
    ) {
        this.clock = options.clock ?? (() => new Date());
        this.claimFactory = options.claimFactory ?? (() => `claim-${randomUUID()}`);
        this.attemptFactory = options.attemptFactory ?? (() => `attempt-${randomUUID()}`);
        this.claimLeaseMs = z.number().int().min(1_000).max(300_000).parse(options.claimLeaseMs ?? 30_000);
        this.sendLeaseMs = z.number().int().min(10_000).max(600_000).parse(options.sendLeaseMs ?? 120_000);
        this.credentialOpener = options.credentialOpener ?? (async (credential) => await openTextToImageCredential(credential));
    }

    /** 先由 SQLite 排除 busy/throttled lane，再领取全局最早候选；受阻 lane 不占扫描窗口。 */
    async claimReady(): Promise<ProviderLaneItemSnapshot | null> {
        const now = this.validNow();
        const candidateRows = CandidateRowsSchema.parse(await this.client.$queryRaw(Prisma.sql`
            SELECT i."dispatchKey"
            FROM "TextToImageProviderLaneItem" i
            WHERE i."state" IN ('ready', 'retry_wait')
              AND NOT EXISTS (
                  SELECT 1
                  FROM "TextToImageProviderLaneItem" busy
                  WHERE busy."ownerUserId" = i."ownerUserId"
                    AND busy."providerId" = i."providerId"
                    AND busy."state" IN ('leased', 'retry_leased', 'attempt_started')
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM "TextToImageProviderThrottle" throttle
                  WHERE throttle."ownerUserId" = i."ownerUserId"
                    AND throttle."providerId" = i."providerId"
                    AND (throttle."activeAttemptId" IS NOT NULL OR throttle."nextAllowedAt" > ${now})
              )
            ORDER BY i."createdAt" ASC, i."dispatchKey" ASC
            LIMIT 100
        `));
        const records = await this.client.textToImageProviderLaneItem.findMany({
            where: {dispatchKey: {in: candidateRows.map((row) => row.dispatchKey)}},
        });
        const recordsByKey = new Map(records.map((record) => [record.dispatchKey, record]));
        for (const row of candidateRows) {
            const candidate = recordsByKey.get(row.dispatchKey);
            if (!candidate) continue;
            const claimed = await this.client.$transaction(async (transaction) => {
                await lockDatabaseKey(transaction, candidate.ownerUserId);
                const busy = await transaction.textToImageProviderLaneItem.count({
                    where: {
                        ownerUserId: candidate.ownerUserId,
                        providerId: candidate.providerId,
                        state: {in: ["leased", "retry_leased", "attempt_started"]},
                    },
                });
                if (busy > 0) return null;
                const throttle = await transaction.textToImageProviderThrottle.findUnique({
                    where: {ownerUserId_providerId: {ownerUserId: candidate.ownerUserId, providerId: candidate.providerId}},
                });
                if (throttle?.activeAttemptId || (throttle && throttle.nextAllowedAt.getTime() > now.getTime())) return null;
                const claimId = StableIdSchema.parse(this.claimFactory());
                const claimLeaseUntil = new Date(now.getTime() + this.claimLeaseMs);
                const updated = await transaction.textToImageProviderLaneItem.updateMany({
                    where: {dispatchKey: candidate.dispatchKey, state: candidate.state, stateVersion: candidate.stateVersion},
                    data: {
                        state: candidate.state === "retry_wait" ? "retry_leased" : "leased",
                        stateVersion: {increment: 1},
                        claimId,
                        claimLeaseUntil,
                    },
                });
                if (updated.count !== 1) return null;
                return await transaction.textToImageProviderLaneItem.findUniqueOrThrow({where: {dispatchKey: candidate.dispatchKey}});
            });
            if (claimed) return laneSnapshot(claimed);
        }
        return null;
    }

    /** 同一 App 事务复验 revision、解密凭据、领取 fence 并持久化 attempt_started。 */
    async startAttempt(leasedInput: ProviderLaneItemSnapshot): Promise<ProviderLaneAttemptStart | null> {
        const leased = ProviderLaneItemSnapshotSchema.parse(leasedInput);
        if (leased.state !== "leased" && leased.state !== "retry_leased") return null;
        const now = this.validNow();
        try {
            return await this.client.$transaction(async (transaction) => {
                await lockDatabaseKey(transaction, leased.ownerUserId);
                const current = await transaction.textToImageProviderLaneItem.findUnique({where: {dispatchKey: leased.dispatchKey}});
                if (!current || !sameLeasedClaim(current, leased) || !current.claimLeaseUntil || current.claimLeaseUntil.getTime() <= now.getTime()) {
                    return null;
                }
                const provider = await transaction.textToImageProvider.findFirst({
                    where: {id: leased.providerId, ownerUserId: leased.ownerUserId, kind: "novelai"},
                    select: {
                        credentialRevision: true,
                        credentialCiphertext: true,
                        credentialIv: true,
                        credentialTag: true,
                        settings: true,
                    },
                });
                if (!provider || provider.credentialRevision !== leased.providerCredentialRevision) {
                    const stale = await transaction.textToImageProviderLaneItem.updateMany({
                        where: {dispatchKey: leased.dispatchKey, state: leased.state, stateVersion: current.stateVersion},
                        data: {
                            state: "quarantined",
                            stateVersion: {increment: 1},
                            claimId: null,
                            claimLeaseUntil: null,
                            errorCode: "TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE",
                            errorMessage: "Provider credential revision 已过期",
                        },
                    });
                    if (stale.count !== 1) throw new ProviderLaneCasRejected();
                    return null;
                }
                let credential: string;
                try {
                    credential = await this.credentialOpener({
                        ciphertext: provider.credentialCiphertext,
                        iv: provider.credentialIv,
                        tag: provider.credentialTag,
                    });
                } catch (error) {
                    return {
                        kind: "configuration_error",
                        item: laneSnapshot(current),
                        code: "TEXT_TO_IMAGE_PROVIDER_CREDENTIAL_INVALID",
                        message: error instanceof Error && error.message.trim()
                            ? error.message.trim().slice(0, 1_000)
                            : "Provider 凭据无法解密",
                    };
                }
                const settings = TextToImageProviderSettingsSchema.parse(provider.settings);
                const intervalMs = Math.max(MINIMUM_NOVELAI_INTERVAL_MS, settings.requestIntervalMs);
                const existingThrottle = await transaction.textToImageProviderThrottle.findUnique({
                    where: {ownerUserId_providerId: {ownerUserId: leased.ownerUserId, providerId: leased.providerId}},
                });
                if (existingThrottle?.activeAttemptId
                    || (existingThrottle && existingThrottle.nextAllowedAt.getTime() > now.getTime())) {
                    return null;
                }
                const attemptId = StableIdSchema.parse(this.attemptFactory());
                const fence = (existingThrottle?.fencingVersion ?? 0) + 1;
                const sendLeaseUntil = new Date(now.getTime() + this.sendLeaseMs);
                const nextAllowedAt = new Date(now.getTime() + intervalMs);
                await transaction.textToImageProviderThrottle.upsert({
                    where: {ownerUserId_providerId: {ownerUserId: leased.ownerUserId, providerId: leased.providerId}},
                    create: {
                        ownerUserId: leased.ownerUserId,
                        providerId: leased.providerId,
                        nextAllowedAt,
                        activeAttemptId: attemptId,
                        leaseUntil: sendLeaseUntil,
                        fencingVersion: fence,
                    },
                    update: {
                        nextAllowedAt,
                        activeAttemptId: attemptId,
                        leaseUntil: sendLeaseUntil,
                        fencingVersion: fence,
                    },
                });
                const updated = await transaction.textToImageProviderLaneItem.updateMany({
                    where: {dispatchKey: leased.dispatchKey, state: leased.state, stateVersion: current.stateVersion, claimId: leased.claimId},
                    data: {
                        state: "attempt_started",
                        stateVersion: {increment: 1},
                        sendAttemptId: attemptId,
                        sendLeaseUntil,
                        sendFence: fence,
                        attemptCount: {increment: 1},
                        errorCode: null,
                        errorMessage: null,
                    },
                });
                if (updated.count !== 1) throw new ProviderLaneCasRejected();
                const started = await transaction.textToImageProviderLaneItem.findUniqueOrThrow({where: {dispatchKey: leased.dispatchKey}});
                return {kind: "started", item: laneSnapshot(started), credential};
            });
        } catch (error) {
            if (error instanceof ProviderLaneCasRejected) return null;
            throw error;
        }
    }

    /** paid boundary 前的 Project 复验失败时，释放 claim 并保存隔离证据。 */
    async quarantineLeased(leasedInput: ProviderLaneItemSnapshot, codeInput: string, messageInput: string): Promise<boolean> {
        const leased = ProviderLaneItemSnapshotSchema.parse(leasedInput);
        if (leased.state !== "leased" && leased.state !== "retry_leased") return false;
        const code = StableErrorCodeSchema.parse(codeInput);
        const message = z.string().trim().min(1).max(1_000).parse(messageInput);
        const updated = await this.client.textToImageProviderLaneItem.updateMany({
            where: {
                dispatchKey: leased.dispatchKey,
                state: leased.state,
                stateVersion: leased.stateVersion,
                claimId: leased.claimId,
            },
            data: {
                state: "quarantined",
                stateVersion: {increment: 1},
                claimId: null,
                claimLeaseUntil: null,
                errorCode: code,
                errorMessage: message,
            },
        });
        return updated.count === 1;
    }

    /** matching attempt/fence 的明确成功终态。 */
    async complete(started: ProviderLaneItemSnapshot): Promise<boolean> {
        return await this.settle(started, {state: "completed", errorCode: null, errorMessage: null});
    }

    /** matching attempt/fence 的明确失败终态；自动 retry 必须另走显式 rearm。 */
    async fail(started: ProviderLaneItemSnapshot, codeInput: string, messageInput: string): Promise<boolean> {
        return await this.settle(started, {
            state: "failed",
            errorCode: StableErrorCodeSchema.parse(codeInput),
            errorMessage: z.string().trim().min(1).max(1_000).parse(messageInput),
        });
    }

    /** 只有收到明确 429/5xx 响应时才重排；保留旧 attempt 证据，下一轮重新领取 throttle fence。 */
    async retry(startedInput: ProviderLaneItemSnapshot, codeInput: string, messageInput: string): Promise<ProviderLaneRetryOutcome> {
        const started = ProviderLaneItemSnapshotSchema.parse(startedInput);
        if (started.state !== "attempt_started" || !started.sendAttemptId || started.sendFence === null) return null;
        const code = RetryableNovelAiErrorCodeSchema.parse(codeInput);
        const message = z.string().trim().min(1).max(1_000).parse(messageInput);
        try {
            return await this.client.$transaction(async (transaction) => {
                await lockDatabaseKey(transaction, started.ownerUserId);
                const current = await transaction.textToImageProviderLaneItem.findUnique({where: {dispatchKey: started.dispatchKey}});
                if (!current || !sameStartedAttempt(current, started)) return null;
                const provider = await transaction.textToImageProvider.findFirst({
                    where: {id: started.providerId, ownerUserId: started.ownerUserId, kind: "novelai"},
                    select: {credentialRevision: true},
                });
                const throttle = await transaction.textToImageProviderThrottle.updateMany({
                    where: {
                        ownerUserId: started.ownerUserId,
                        providerId: started.providerId,
                        activeAttemptId: started.sendAttemptId,
                        fencingVersion: started.sendFence,
                    },
                    data: {activeAttemptId: null, leaseUntil: null},
                });
                if (throttle.count !== 1) throw new ProviderLaneCasRejected();
                if (!provider || provider.credentialRevision !== started.providerCredentialRevision) {
                    const stale = await transaction.textToImageProviderLaneItem.updateMany({
                        where: {
                            dispatchKey: started.dispatchKey,
                            state: "attempt_started",
                            stateVersion: current.stateVersion,
                            sendAttemptId: started.sendAttemptId,
                            sendFence: started.sendFence,
                        },
                        data: {
                            state: "quarantined",
                            stateVersion: {increment: 1},
                            claimId: null,
                            claimLeaseUntil: null,
                            errorCode: "TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE",
                            errorMessage: "NovelAI API token 已更新；旧配置生成任务必须重新预览并授权。",
                        },
                    });
                    if (stale.count !== 1) throw new ProviderLaneCasRejected();
                    if (provider && provider.credentialRevision > started.providerCredentialRevision) {
                        const identity = {
                            ownerUserId: started.ownerUserId,
                            providerId: started.providerId,
                            oldRevision: started.providerCredentialRevision,
                            newRevision: provider.credentialRevision,
                            projectId: started.projectId,
                        };
                        const invalidationId = createProviderRevisionInvalidationId(identity);
                        await transaction.textToImageProviderRevisionInvalidation.upsert({
                            where: {id: invalidationId},
                            create: {
                                id: invalidationId,
                                ...identity,
                                projectPath: started.projectPath,
                            },
                            update: {
                                projectPath: started.projectPath,
                                state: "pending",
                                lastError: null,
                            },
                        });
                    }
                    return "configuration_stale";
                }
                const item = await transaction.textToImageProviderLaneItem.updateMany({
                    where: {
                        dispatchKey: started.dispatchKey,
                        state: "attempt_started",
                        stateVersion: current.stateVersion,
                        sendAttemptId: started.sendAttemptId,
                        sendFence: started.sendFence,
                    },
                    data: {
                        state: "retry_wait",
                        stateVersion: {increment: 1},
                        claimId: null,
                        claimLeaseUntil: null,
                        errorCode: code,
                        errorMessage: message,
                    },
                });
                if (item.count !== 1) throw new ProviderLaneCasRejected();
                return "retry_wait";
            });
        } catch (error) {
            if (error instanceof ProviderLaneCasRejected) return null;
            throw error;
        }
    }

    /** 任何可能已触发付费但结果不确定的出口。 */
    async outcomeUnknown(started: ProviderLaneItemSnapshot, message = OUTCOME_UNKNOWN_MESSAGE): Promise<boolean> {
        return await this.settle(started, {
            state: "outcome_unknown",
            errorCode: "TEXT_TO_IMAGE_OUTCOME_UNKNOWN",
            errorMessage: z.string().trim().min(1).max(1_000).parse(message),
        });
    }

    /** leased/retry_leased 崩溃可安全释放 claim；attempt_started 需由 Project 证据决定出口。 */
    async recoverExpired(limitInput: number): Promise<ProviderLaneRecoveryResult> {
        return await this.recoverExpiredWith(limitInput, async () => ({
            kind: "outcome_unknown",
            message: OUTCOME_UNKNOWN_MESSAGE,
        }));
    }

    /** Project 已有 matching terminal 时镜像终态，否则才把过期 attempt 收口为 outcome_unknown。 */
    async recoverExpiredWith(
        limitInput: number,
        resolveAttempt: (item: ProviderLaneItemSnapshot) => Promise<ExpiredAttemptResolution>,
    ): Promise<ProviderLaneRecoveryResult> {
        const limit = z.number().int().min(1).max(100).parse(limitInput);
        const now = this.validNow();
        let leasedRecovered = 0;
        let attemptsRetried = 0;
        let attemptsUnknown = 0;
        const leasedItems = await this.client.textToImageProviderLaneItem.findMany({
            where: {state: {in: ["leased", "retry_leased"]}, claimLeaseUntil: {lte: now}},
            orderBy: {claimLeaseUntil: "asc"},
            take: limit,
        });
        for (const item of leasedItems) {
            const recovered = await this.client.$transaction(async (transaction) => {
                await lockDatabaseKey(transaction, item.ownerUserId);
                const updated = await transaction.textToImageProviderLaneItem.updateMany({
                    where: {dispatchKey: item.dispatchKey, state: item.state, stateVersion: item.stateVersion, claimId: item.claimId},
                    data: {
                        state: item.state === "retry_leased" ? "retry_wait" : "ready",
                        stateVersion: {increment: 1},
                        claimId: null,
                        claimLeaseUntil: null,
                    },
                });
                return updated.count === 1;
            });
            if (recovered) leasedRecovered += 1;
        }
        const remaining = limit - leasedRecovered;
        if (remaining <= 0) return {leasedRecovered, attemptsRetried, attemptsUnknown};
        const startedItems = await this.client.textToImageProviderLaneItem.findMany({
            where: {state: "attempt_started", sendLeaseUntil: {lte: now}},
            orderBy: {sendLeaseUntil: "asc"},
            take: remaining,
        });
        for (const item of startedItems) {
            const snapshot = laneSnapshot(item);
            let resolution: ExpiredAttemptResolution;
            try {
                resolution = await resolveAttempt(snapshot);
            } catch (error) {
                resolution = {
                    kind: "outcome_unknown",
                    message: error instanceof Error ? error.message : OUTCOME_UNKNOWN_MESSAGE,
                };
            }
            if (resolution.kind === "completed") {
                await this.complete(snapshot);
            } else if (resolution.kind === "retryable") {
                if (await this.retry(snapshot, resolution.code, resolution.message) === "retry_wait") attemptsRetried += 1;
            } else if (resolution.kind === "failed") {
                await this.fail(snapshot, resolution.code, resolution.message);
            } else if (await this.outcomeUnknown(snapshot, resolution.message)) {
                attemptsUnknown += 1;
            }
        }
        return {leasedRecovered, attemptsRetried, attemptsUnknown};
    }

    /** 仅在节流时间已过、无 active attempt 且无 sendable item 时清理空 lane。 */
    async cleanupIdle(limitInput: number): Promise<number> {
        const limit = z.number().int().min(1).max(100).parse(limitInput);
        const now = this.validNow();
        const candidates = await this.client.textToImageProviderThrottle.findMany({
            where: {activeAttemptId: null, leaseUntil: null, nextAllowedAt: {lte: now}},
            orderBy: {updatedAt: "asc"},
            take: limit,
        });
        let removed = 0;
        for (const candidate of candidates) {
            const deleted = await this.client.$transaction(async (transaction) => {
                await lockDatabaseKey(transaction, candidate.ownerUserId);
                const activeItems = await transaction.textToImageProviderLaneItem.count({
                    where: {
                        ownerUserId: candidate.ownerUserId,
                        providerId: candidate.providerId,
                        state: {in: ["ready", "leased", "retry_wait", "retry_leased", "attempt_started"]},
                    },
                });
                if (activeItems > 0) return false;
                const result = await transaction.textToImageProviderThrottle.deleteMany({
                    where: {
                        ownerUserId: candidate.ownerUserId,
                        providerId: candidate.providerId,
                        activeAttemptId: null,
                        leaseUntil: null,
                        fencingVersion: candidate.fencingVersion,
                        nextAllowedAt: candidate.nextAllowedAt,
                    },
                });
                return result.count === 1;
            });
            if (deleted) removed += 1;
        }
        return removed;
    }

    private async settle(
        startedInput: ProviderLaneItemSnapshot,
        terminal: {
            state: "completed" | "failed" | "outcome_unknown";
            errorCode: string | null;
            errorMessage: string | null;
        },
    ): Promise<boolean> {
        const started = ProviderLaneItemSnapshotSchema.parse(startedInput);
        if (started.state !== "attempt_started" || !started.sendAttemptId || started.sendFence === null) return false;
        try {
            return await this.client.$transaction(async (transaction) => {
                await lockDatabaseKey(transaction, started.ownerUserId);
                const current = await transaction.textToImageProviderLaneItem.findUnique({where: {dispatchKey: started.dispatchKey}});
                if (!current || !sameStartedAttempt(current, started)) return false;
                const throttle = await transaction.textToImageProviderThrottle.updateMany({
                    where: {
                        ownerUserId: started.ownerUserId,
                        providerId: started.providerId,
                        activeAttemptId: started.sendAttemptId,
                        fencingVersion: started.sendFence,
                    },
                    data: {activeAttemptId: null, leaseUntil: null},
                });
                if (throttle.count !== 1) throw new ProviderLaneCasRejected();
                const item = await transaction.textToImageProviderLaneItem.updateMany({
                    where: {
                        dispatchKey: started.dispatchKey,
                        state: "attempt_started",
                        stateVersion: current.stateVersion,
                        sendAttemptId: started.sendAttemptId,
                        sendFence: started.sendFence,
                    },
                    data: {
                        state: terminal.state,
                        stateVersion: {increment: 1},
                        claimId: null,
                        claimLeaseUntil: null,
                        errorCode: terminal.errorCode,
                        errorMessage: terminal.errorMessage,
                    },
                });
                if (item.count !== 1) throw new ProviderLaneCasRejected();
                return true;
            });
        } catch (error) {
            if (error instanceof ProviderLaneCasRejected) return false;
            throw error;
        }
    }

    private validNow(): Date {
        const now = this.clock();
        if (Number.isNaN(now.getTime())) throw new Error("TEXT_TO_IMAGE_PROVIDER_LANE_INVALID_CLOCK");
        return now;
    }
}

/** Prisma record 必须通过共享状态不变量后才能越过 repository 边界。 */
function laneSnapshot(item: TextToImageProviderLaneItem): ProviderLaneItemSnapshot {
    return ProviderLaneItemSnapshotSchema.parse({
        schemaVersion: "nbook.text-to-image-provider-lane-item/v1",
        dispatchKey: item.dispatchKey,
        preparationId: item.preparationId,
        jobId: item.jobId,
        ownerUserId: item.ownerUserId,
        providerId: item.providerId,
        providerCredentialRevision: item.providerCredentialRevision,
        projectId: item.projectId,
        projectPath: item.projectPath,
        manifestHash: item.manifestHash,
        prepareAttemptId: item.prepareAttemptId,
        prepareVersion: item.prepareVersion,
        state: item.state,
        stateVersion: item.stateVersion,
        claimId: item.claimId,
        claimLeaseUntil: item.claimLeaseUntil?.toISOString() ?? null,
        sendAttemptId: item.sendAttemptId,
        sendLeaseUntil: item.sendLeaseUntil?.toISOString() ?? null,
        sendFence: item.sendFence,
        attemptCount: item.attemptCount,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
    });
}

function sameLeasedClaim(current: TextToImageProviderLaneItem, leased: ProviderLaneItemSnapshot): boolean {
    return current.state === leased.state
        && (current.state === "leased" || current.state === "retry_leased")
        && current.stateVersion === leased.stateVersion
        && current.claimId === leased.claimId
        && current.claimLeaseUntil?.toISOString() === leased.claimLeaseUntil;
}

function sameStartedAttempt(current: TextToImageProviderLaneItem, started: ProviderLaneItemSnapshot): boolean {
    return current.state === "attempt_started"
        && current.stateVersion === started.stateVersion
        && current.sendAttemptId === started.sendAttemptId
        && current.sendFence === started.sendFence;
}
