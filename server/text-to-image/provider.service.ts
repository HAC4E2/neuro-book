import {createHash} from "node:crypto";
import {createError} from "h3";
import {z} from "zod";
import type {
    TextToImageNovelAiInspectionDto,
    TextToImageNovelAiReconciliationDto,
    TextToImageNovelAiReconciliationImpactDto,
    TextToImageProviderDto,
    TextToImageProviderKind,
    TextToImageProviderSnapshotDto,
} from "nbook/shared/dto/text-to-image.dto";
import {
    Prisma,
    type PrismaClient,
    type TextToImageProvider,
    type TextToImageProviderReconciliation,
    type TextToImageProviderRevisionInvalidation,
} from "nbook/server/generated/prisma/client";
import {lockDatabaseKey} from "nbook/server/database/locks";
import {prisma} from "nbook/server/utils/prisma";
import {ProjectTextToImageProviderJobReconciler} from "nbook/server/text-to-image/provider-reconciliation.service";
import {isExpectedNovelAiProviderIndexSql} from "nbook/scripts/db/novelai-provider-constraint.mjs";
import {
    openTextToImageCredential,
    sealTextToImageCredential,
} from "nbook/server/text-to-image/provider-credential";
import {
    TextToImageProviderSettingsSchema,
    TextToImageProviderSnapshotsSchema,
    TextToImageNovelAiProviderPutSchema,
    TextToImageNovelAiReconcileSchema,
    TEXT_TO_IMAGE_NOVELAI_BASE_URL,
    type TextToImageNovelAiProviderPutInput,
    type TextToImageNovelAiReconcileInput,
} from "nbook/server/text-to-image/schemas";
import {createProviderRevisionInvalidationId} from "nbook/server/text-to-image/provider-revision-invalidation";

export type TextToImageProviderSettings = TextToImageProviderDto["settings"];

export type TextToImageProviderRecord = {
    id: number;
    ownerUserId: number;
    kind: TextToImageProviderKind;
    name: string;
    baseUrl: string;
    /** 图片模型只属于 Project Recipe；singleton Provider 运行时始终为空。 */
    model: string | null;
    /** 旧运行链实际使用过的 NovelAI model，仅供一次性 Recipe migration preflight 展示。 */
    recipeMigrationModel: string | null;
    credentialCiphertext: string;
    credentialIv: string;
    credentialTag: string;
    credentialRevision: number;
    settings: TextToImageProviderSettings;
    createdAt: Date;
    updatedAt: Date;
};

/** 任何 Project mutation 前落入 App DB 的一次性恢复决定。 */
export type TextToImageProviderReconciliationRecord = {
    ownerUserId: number;
    selectionToken: string;
    keepProviderId: number;
    discardedProviders: TextToImageProviderSnapshotDto[];
    createdAt: Date;
    updatedAt: Date;
};

/** Provider 凭证替换后的跨库失效 saga；App DB 是恢复真相源。 */
export type TextToImageProviderRevisionInvalidationRecord = {
    id: string;
    ownerUserId: number;
    providerId: number;
    oldRevision: number;
    newRevision: number;
    projectId: string;
    projectPath: string;
    state: "pending" | "completed";
    attemptCount: number;
    /** 最近一次 Project 同步错误；尚未失败或已完成时为空。 */
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
};

/**
 * 隔离 Provider 领域服务与 App Prisma 客户端，测试只需提供具备 owner scope 的最小存储实现。
 */
export interface TextToImageProviderStore {
    create(record: Omit<TextToImageProviderRecord, "id" | "createdAt" | "updatedAt">): Promise<TextToImageProviderRecord>;
    findMany(ownerUserId: number): Promise<TextToImageProviderRecord[]>;
    find(ownerUserId: number, id: number): Promise<TextToImageProviderRecord | null>;
    update(ownerUserId: number, id: number, update: Partial<Omit<TextToImageProviderRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">>): Promise<TextToImageProviderRecord | null>;
    delete(ownerUserId: number, id: number): Promise<boolean>;
    findReconciliation(ownerUserId: number): Promise<TextToImageProviderReconciliationRecord | null>;
    createReconciliation(record: Omit<TextToImageProviderReconciliationRecord, "createdAt" | "updatedAt">): Promise<TextToImageProviderReconciliationRecord>;
    deleteReconciliation(ownerUserId: number, selectionToken: string): Promise<boolean>;
    /** 同一 App 事务内隔离所有未越过付费边界的旧 revision，并写入可恢复 saga。 */
    invalidateCredentialRevision(ownerUserId: number, providerId: number, oldRevision: number, newRevision: number): Promise<TextToImageProviderRevisionInvalidationRecord[]>;
    findPendingRevisionInvalidations(limit: number): Promise<TextToImageProviderRevisionInvalidationRecord[]>;
    completeRevisionInvalidation(id: string): Promise<boolean>;
    failRevisionInvalidation(id: string, message: string): Promise<boolean>;
    /** 在 App DB owner 写锁事务中执行完整 mutation；回调收到同一事务作用域的 store。 */
    withOwnerMutation<T>(ownerUserId: number, operation: (store: TextToImageProviderStore) => Promise<T>): Promise<T>;
    /** 无重复 owner 时安装最终 partial unique；否则保留迁移期数据库 trigger。 */
    finalizeNovelAiConstraint(): Promise<"enforced" | "pending_other_owners">;
}

/** 失效所有可发现 Project 中绑定已丢弃 Provider 的旧未完成 Job。 */
export interface TextToImageProviderJobReconciler {
    invalidate(providers: TextToImageProviderSnapshotDto[]): Promise<TextToImageNovelAiReconciliationImpactDto[]>;
    /** 只失效尚未开始的旧 revision；running/completing 保留原 fence 与凭证闭包。 */
    invalidateRevision(target: TextToImageProviderRevisionInvalidationRecord): Promise<TextToImageNovelAiReconciliationImpactDto[]>;
}

/** 旧数据存在多条 NovelAI Provider，必须由用户显式选择后才能继续。 */
export class TextToImageProviderSelectionRequiredError extends Error {
    readonly code = "TEXT_TO_IMAGE_PROVIDER_SELECTION_REQUIRED";

    constructor() {
        super("检测到多条 NovelAI Provider，请先显式选择要保留的配置。");
        this.name = "TextToImageProviderSelectionRequiredError";
    }
}

/** 用户提交的候选快照已变化，必须刷新后重新确认。 */
export class TextToImageProviderSelectionStaleError extends Error {
    readonly code = "TEXT_TO_IMAGE_PROVIDER_SELECTION_STALE";

    constructor() {
        super("NovelAI Provider 候选配置已变化，请刷新后重新选择。");
        this.name = "TextToImageProviderSelectionStaleError";
    }
}

/** 唯一 Provider 存在但密钥材料不完整，任何 Job 都不得先落库。 */
export class TextToImageProviderNotConfiguredError extends Error {
    readonly code = "TEXT_TO_IMAGE_PROVIDER_NOT_CONFIGURED";

    constructor() {
        super("NovelAI Provider 尚未配置完整 API token，请先在文生图分页保存凭据。");
        this.name = "TextToImageProviderNotConfiguredError";
    }
}

/** 已有跨库处理决定时只能恢复同一 keep/token，不能在部分提交后改选。 */
export class TextToImageProviderReconciliationInProgressError extends Error {
    readonly code = "TEXT_TO_IMAGE_PROVIDER_RECONCILIATION_IN_PROGRESS";

    constructor() {
        super("NovelAI Provider 对账曾部分执行；请继续恢复原先确认保留的配置，不能改选其他 Provider。");
        this.name = "TextToImageProviderReconciliationInProgressError";
    }
}

/** 数据库拒绝创建第二条 NovelAI Provider。 */
export class TextToImageProviderSingletonConflictError extends Error {
    readonly code = "TEXT_TO_IMAGE_PROVIDER_SINGLETON_CONFLICT";

    constructor() {
        super("当前用户已经存在唯一 NovelAI Provider，请刷新后重试。");
        this.name = "TextToImageProviderSingletonConflictError";
    }
}

/**
 * Provider 安全边界：所有读写均绑定 owner，DTO 永不包含密钥材料。
 */
export class TextToImageProviderService {
    constructor(
        private readonly store: TextToImageProviderStore = new PrismaTextToImageProviderStore(),
        private readonly keyPath?: string,
        private readonly jobReconciler: TextToImageProviderJobReconciler = new ProjectTextToImageProviderJobReconciler(),
    ) {}

    /** 返回 NovelAI singleton 状态；无重复 owner 时幂等最终化 DB constraint，候选始终脱敏。 */
    async inspectNovelAi(ownerUserId: number): Promise<TextToImageNovelAiInspectionDto> {
        await this.store.finalizeNovelAiConstraint();
        const [allRecords, reconciliation] = await Promise.all([
            this.store.findMany(ownerUserId),
            this.store.findReconciliation(ownerUserId),
        ]);
        return buildNovelAiInspection(ownerUserId, allRecords.filter((record) => record.kind === "novelai"), reconciliation);
    }

    /**
     * 显式保留一条旧 NovelAI Provider。
     * 第一个短 App 事务先持久化 owner-scoped 决定；Project 逐库幂等提交后，第二个短事务才删除 Provider。
     * 任一 Project 失败都会保留决定，后续只允许恢复同一 keep/token。
     */
    async reconcileNovelAi(ownerUserId: number, input: TextToImageNovelAiReconcileInput): Promise<TextToImageNovelAiReconciliationDto> {
        const parsed = TextToImageNovelAiReconcileSchema.parse(input);
        const decision = await this.store.withOwnerMutation(ownerUserId, async (transactionStore) => {
            const existingDecision = await transactionStore.findReconciliation(ownerUserId);
            if (existingDecision) {
                if (existingDecision.keepProviderId !== parsed.keepProviderId
                    || existingDecision.selectionToken !== parsed.selectionToken) {
                    throw new TextToImageProviderReconciliationInProgressError();
                }
                return existingDecision;
            }
            const records = (await transactionStore.findMany(ownerUserId)).filter((record) => record.kind === "novelai");
            const inspection = buildNovelAiInspection(ownerUserId, records, null);
            if (inspection.state !== "selection_required") {
                throw new TextToImageProviderSelectionStaleError();
            }
            if (inspection.selectionToken !== parsed.selectionToken) {
                throw new TextToImageProviderSelectionStaleError();
            }
            const kept = records.find((record) => record.id === parsed.keepProviderId);
            if (!kept) {
                throw new TextToImageProviderSelectionStaleError();
            }
            return await transactionStore.createReconciliation({
                ownerUserId,
                selectionToken: parsed.selectionToken,
                keepProviderId: kept.id,
                discardedProviders: records
                    .filter((record) => record.id !== kept.id)
                    .map((record) => toProviderSnapshot(record)),
            });
        });

        const impacts = await this.jobReconciler.invalidate(decision.discardedProviders);
        return await this.store.withOwnerMutation(ownerUserId, async (transactionStore) => {
            const persistedDecision = await transactionStore.findReconciliation(ownerUserId);
            if (!persistedDecision
                || persistedDecision.keepProviderId !== decision.keepProviderId
                || persistedDecision.selectionToken !== decision.selectionToken) {
                throw new TextToImageProviderReconciliationInProgressError();
            }
            const records = (await transactionStore.findMany(ownerUserId)).filter((record) => record.kind === "novelai");
            const expectedProviderIds = [decision.keepProviderId, ...decision.discardedProviders.map((provider) => provider.providerId)]
                .sort((left, right) => left - right);
            const actualProviderIds = records.map((record) => record.id).sort((left, right) => left - right);
            if (!isSameNumberList(expectedProviderIds, actualProviderIds)
                || createNovelAiSelectionToken(ownerUserId, records) !== decision.selectionToken) {
                throw new TextToImageProviderReconciliationInProgressError();
            }
            const kept = records.find((record) => record.id === decision.keepProviderId);
            if (!kept || !await transactionStore.update(ownerUserId, kept.id, {
                settings: {
                    allowPrivateNetwork: false,
                    requestIntervalMs: Math.max(15_000, kept.settings.requestIntervalMs),
                },
            })) {
                throw new TextToImageProviderReconciliationInProgressError();
            }
            for (const provider of decision.discardedProviders) {
                if (!await transactionStore.delete(ownerUserId, provider.providerId)) {
                    throw new TextToImageProviderReconciliationInProgressError();
                }
            }
            const constraintState = await transactionStore.finalizeNovelAiConstraint();
            if (!await transactionStore.deleteReconciliation(ownerUserId, decision.selectionToken)) {
                throw new TextToImageProviderReconciliationInProgressError();
            }
            const remaining = (await transactionStore.findMany(ownerUserId)).filter((record) => record.kind === "novelai");
            return {
                inspection: buildNovelAiInspection(ownerUserId, remaining, null),
                impacts,
                constraintState,
            };
        });
    }

    /** Worker 落 Project Job 前确认 owner 已收敛到请求中的唯一 Provider，并冻结脱敏快照。 */
    async assertNovelAiReady(ownerUserId: number, providerId: number): Promise<TextToImageProviderSnapshotDto> {
        await this.store.finalizeNovelAiConstraint();
        const [allRecords, reconciliation] = await Promise.all([
            this.store.findMany(ownerUserId),
            this.store.findReconciliation(ownerUserId),
        ]);
        const records = allRecords.filter((record) => record.kind === "novelai");
        if (reconciliation || records.length > 1) {
            throw new TextToImageProviderSelectionRequiredError();
        }
        const provider = records[0];
        if (!provider) {
            throw new TextToImageProviderNotConfiguredError();
        }
        if (provider.id !== providerId) {
            throw providerNotFoundError();
        }
        if (!hasProviderCredential(provider)) {
            throw new TextToImageProviderNotConfiguredError();
        }
        return toProviderSnapshot(provider);
    }

    /**
     * 从 owner 唯一 NovelAI 配置解析可执行脱敏快照。
     * 调用方不能提交 providerId，因此 Preview/授权入口不会形成第二套 Provider 选择真相源。
     */
    async resolveNovelAiSnapshot(ownerUserId: number): Promise<TextToImageProviderSnapshotDto> {
        const [allRecords, reconciliation] = await Promise.all([
            this.store.findMany(ownerUserId),
            this.store.findReconciliation(ownerUserId),
        ]);
        const records = allRecords.filter((record) => record.kind === "novelai");
        if (reconciliation || records.length > 1) {
            throw new TextToImageProviderSelectionRequiredError();
        }
        const provider = records[0];
        if (!provider || !hasProviderCredential(provider)) {
            throw new TextToImageProviderNotConfiguredError();
        }
        return toProviderSnapshot(provider);
    }

    /** 首次创建、后续原 id 更新；重复旧数据时 fail-closed，绝不猜选。 */
    async saveNovelAi(ownerUserId: number, input: TextToImageNovelAiProviderPutInput): Promise<Extract<TextToImageProviderDto, {kind: "novelai"}>> {
        const parsed = TextToImageNovelAiProviderPutSchema.parse(input);
        const sealedCredential = parsed.credential
            ? await sealTextToImageCredential(parsed.credential, this.keyPath)
            : null;
        try {
            const result = await this.store.withOwnerMutation(ownerUserId, async (transactionStore) => {
                await transactionStore.finalizeNovelAiConstraint();
                const records = (await transactionStore.findMany(ownerUserId)).filter((record) => record.kind === "novelai");
                if (records.length > 1) {
                    throw new TextToImageProviderSelectionRequiredError();
                }
                const settings: TextToImageProviderSettings = {
                    allowPrivateNetwork: false,
                    requestIntervalMs: Math.max(15_000, parsed.requestIntervalMs),
                };
                const existing = records[0];
                if (!existing) {
                    if (!sealedCredential) {
                        throw new TextToImageProviderNotConfiguredError();
                    }
                    const created = await transactionStore.create({
                        ownerUserId,
                        kind: "novelai",
                        name: parsed.name,
                        baseUrl: TEXT_TO_IMAGE_NOVELAI_BASE_URL,
                        model: null,
                        recipeMigrationModel: null,
                        credentialCiphertext: sealedCredential.ciphertext,
                        credentialIv: sealedCredential.iv,
                        credentialTag: sealedCredential.tag,
                        credentialRevision: 1,
                        settings,
                    });
                    return {provider: toNovelAiDto(created), invalidations: []};
                }
                if (!sealedCredential && !hasProviderCredential(existing)) {
                    throw new TextToImageProviderNotConfiguredError();
                }
                const oldRevision = existing.credentialRevision;
                const credentialChanged = parsed.credential !== undefined
                    && (!hasProviderCredential(existing) || parsed.credential !== await this.openCredential(existing));
                const nextRevision = credentialChanged
                    ? nextCredentialRevision(oldRevision)
                    : oldRevision;
                const update: Partial<Omit<TextToImageProviderRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">> = {
                    name: parsed.name,
                    baseUrl: TEXT_TO_IMAGE_NOVELAI_BASE_URL,
                    model: null,
                    settings,
                    ...(sealedCredential ? {
                        credentialCiphertext: sealedCredential.ciphertext,
                        credentialIv: sealedCredential.iv,
                        credentialTag: sealedCredential.tag,
                        credentialRevision: nextRevision,
                    } : {}),
                };
                const updated = await transactionStore.update(ownerUserId, existing.id, update);
                if (!updated) {
                    throw providerNotFoundError();
                }
                const invalidations = credentialChanged
                    ? await transactionStore.invalidateCredentialRevision(
                        ownerUserId,
                        existing.id,
                        oldRevision,
                        nextRevision,
                    )
                    : [];
                return {provider: toNovelAiDto(updated), invalidations};
            });
            for (const invalidation of result.invalidations) {
                try {
                    await this.jobReconciler.invalidateRevision(invalidation);
                    await this.store.completeRevisionInvalidation(invalidation.id);
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Project revision invalidation failed";
                    await this.store.failRevisionInvalidation(invalidation.id, message);
                }
            }
            return result.provider;
        } catch (error) {
            if (isNovelAiSingletonConflict(error)) {
                throw new TextToImageProviderSingletonConflictError();
            }
            throw error;
        }
    }

    /** Queue 使用的唯一 NovelAI 凭据出口；多条旧记录时所有 worker 均停止。 */
    async resolveNovelAiCredential(ownerUserId: number, providerId: number): Promise<{
        provider: Extract<TextToImageProviderDto, {kind: "novelai"}>;
        credential: string;
    }> {
        const inspection = await this.inspectNovelAi(ownerUserId);
        if (inspection.state === "selection_required") {
            throw new TextToImageProviderSelectionRequiredError();
        }
        if (inspection.state === "unconfigured" || !inspection.provider) {
            throw new TextToImageProviderNotConfiguredError();
        }
        if (inspection.provider.id !== providerId) {
            throw providerNotFoundError();
        }
        const record = await this.requireRecord(ownerUserId, providerId);
        if (!hasProviderCredential(record)) {
            throw new TextToImageProviderNotConfiguredError();
        }
        return {
            provider: inspection.provider,
            credential: await this.openCredential(record),
        };
    }

    private async openCredential(record: TextToImageProviderRecord): Promise<string> {
        if (!record.credentialCiphertext || !record.credentialIv || !record.credentialTag) {
            throw createError({statusCode: 400, message: "Provider 尚未配置凭据"});
        }
        return await openTextToImageCredential({
            ciphertext: record.credentialCiphertext,
            iv: record.credentialIv,
            tag: record.credentialTag,
        }, this.keyPath);
    }

    private async requireRecord(ownerUserId: number, providerId: number): Promise<TextToImageProviderRecord> {
        const record = await this.store.find(ownerUserId, providerId);
        if (!record) {
            throw providerNotFoundError();
        }
        return record;
    }
}

export class PrismaTextToImageProviderStore implements TextToImageProviderStore {
    constructor(private readonly client: PrismaClient | Prisma.TransactionClient = prisma) {}

    async create(record: Omit<TextToImageProviderRecord, "id" | "createdAt" | "updatedAt">): Promise<TextToImageProviderRecord> {
        return toRecord(await this.client.textToImageProvider.create({
            data: {
                owner: {connect: {id: record.ownerUserId}},
                kind: record.kind,
                name: record.name,
                baseUrl: record.baseUrl,
                model: record.model,
                recipeMigrationModel: record.recipeMigrationModel,
                credentialCiphertext: record.credentialCiphertext,
                credentialIv: record.credentialIv,
                credentialTag: record.credentialTag,
                credentialRevision: record.credentialRevision,
                settings: record.settings,
            },
        }));
    }

    async findMany(ownerUserId: number): Promise<TextToImageProviderRecord[]> {
        const records = await this.client.textToImageProvider.findMany({
            where: {ownerUserId},
            orderBy: {id: "asc"},
        });
        return records.map((record) => toRecord(record));
    }

    async find(ownerUserId: number, id: number): Promise<TextToImageProviderRecord | null> {
        const record = await this.client.textToImageProvider.findFirst({
            where: {id, ownerUserId},
        });
        return record ? toRecord(record) : null;
    }

    async update(ownerUserId: number, id: number, update: Partial<Omit<TextToImageProviderRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">>): Promise<TextToImageProviderRecord | null> {
        const result = await this.client.textToImageProvider.updateMany({
            where: {id, ownerUserId},
            data: update,
        });
        if (result.count !== 1) {
            return null;
        }
        return await this.find(ownerUserId, id);
    }

    async delete(ownerUserId: number, id: number): Promise<boolean> {
        const result = await this.client.textToImageProvider.deleteMany({
            where: {id, ownerUserId},
        });
        return result.count === 1;
    }

    async findReconciliation(ownerUserId: number): Promise<TextToImageProviderReconciliationRecord | null> {
        const record = await this.client.textToImageProviderReconciliation.findUnique({where: {ownerUserId}});
        return record ? toReconciliationRecord(record) : null;
    }

    async createReconciliation(record: Omit<TextToImageProviderReconciliationRecord, "createdAt" | "updatedAt">): Promise<TextToImageProviderReconciliationRecord> {
        return toReconciliationRecord(await this.client.textToImageProviderReconciliation.create({
            data: {
                owner: {connect: {id: record.ownerUserId}},
                selectionToken: record.selectionToken,
                keepProviderId: record.keepProviderId,
                discardedProvidersJson: JSON.stringify(record.discardedProviders),
            },
        }));
    }

    async deleteReconciliation(ownerUserId: number, selectionToken: string): Promise<boolean> {
        const result = await this.client.textToImageProviderReconciliation.deleteMany({
            where: {ownerUserId, selectionToken},
        });
        return result.count === 1;
    }

    /** 隔离旧 revision 的未发送项并持久化跨库同步 saga；throttle 与 attempt_started 不受影响。 */
    async invalidateCredentialRevision(ownerUserId: number, providerId: number, oldRevision: number, newRevision: number): Promise<TextToImageProviderRevisionInvalidationRecord[]> {
        const errorCode = "TEXT_TO_IMAGE_PROVIDER_CONFIGURATION_STALE";
        const errorMessage = "NovelAI API token 已更新；旧配置生成任务必须重新预览并授权。";
        const targetItems = await this.client.textToImageProviderLaneItem.findMany({
            where: {
                ownerUserId,
                providerId,
                providerCredentialRevision: oldRevision,
                state: {in: ["prepared", "ready", "leased", "retry_wait", "retry_leased"]},
            },
            select: {projectId: true, projectPath: true},
        });
        const targets = [...new Map(targetItems.map((item) => [`${item.projectId}\u0000${item.projectPath}`, item])).values()]
            .sort((left, right) => left.projectId.localeCompare(right.projectId));
        await this.client.textToImageDispatchPreparation.updateMany({
            where: {
                ownerUserId,
                providerId,
                providerCredentialRevision: oldRevision,
                state: {in: ["prepared", "project_committed", "ready"]},
            },
            data: {
                state: "quarantined",
                stateVersion: {increment: 1},
                quarantineCode: errorCode,
                quarantineMessage: errorMessage,
            },
        });
        await this.client.textToImageProviderLaneItem.updateMany({
            where: {
                ownerUserId,
                providerId,
                providerCredentialRevision: oldRevision,
                state: {in: ["prepared", "ready", "leased", "retry_wait", "retry_leased"]},
            },
            data: {
                state: "quarantined",
                stateVersion: {increment: 1},
                claimId: null,
                claimLeaseUntil: null,
                errorCode,
                errorMessage,
            },
        });
        const records: TextToImageProviderRevisionInvalidationRecord[] = [];
        for (const target of targets) {
            const id = createProviderRevisionInvalidationId({
                ownerUserId,
                providerId,
                oldRevision,
                newRevision,
                projectId: target.projectId,
            });
            const record = await this.client.textToImageProviderRevisionInvalidation.upsert({
                where: {id},
                create: {...target, id, ownerUserId, providerId, oldRevision, newRevision},
                update: {projectPath: target.projectPath},
            });
            records.push(toRevisionInvalidationRecord(record));
        }
        return records;
    }

    /** 后台恢复器按创建顺序领取未完成的 revision saga。 */
    async findPendingRevisionInvalidations(limit: number): Promise<TextToImageProviderRevisionInvalidationRecord[]> {
        const boundedLimit = z.number().int().min(1).max(100).parse(limit);
        const records = await this.client.textToImageProviderRevisionInvalidation.findMany({
            where: {state: "pending"},
            orderBy: [{createdAt: "asc"}, {id: "asc"}],
            take: boundedLimit,
        });
        return records.map(toRevisionInvalidationRecord);
    }

    /** Project 逐库失效完成后幂等关闭 saga。 */
    async completeRevisionInvalidation(id: string): Promise<boolean> {
        const result = await this.client.textToImageProviderRevisionInvalidation.updateMany({
            where: {id, state: "pending"},
            data: {state: "completed", lastError: null},
        });
        return result.count === 1;
    }

    /** 保留最近错误并增加 attempt 计数，供后台继续恢复。 */
    async failRevisionInvalidation(id: string, message: string): Promise<boolean> {
        const result = await this.client.textToImageProviderRevisionInvalidation.updateMany({
            where: {id, state: "pending"},
            data: {attemptCount: {increment: 1}, lastError: message.slice(0, 1_000)},
        });
        return result.count === 1;
    }

    /** 使用 SQLite 写事务与 DatabaseLock 行序列化同一 owner 的所有 singleton mutation。 */
    async withOwnerMutation<T>(ownerUserId: number, operation: (store: TextToImageProviderStore) => Promise<T>): Promise<T> {
        if (!("$transaction" in this.client)) {
            throw new Error("事务作用域的 Provider store 不能再次开启 owner mutation");
        }
        for (let attempt = 0; attempt < 6; attempt += 1) {
            try {
                return await this.client.$transaction(async (transaction) => {
                    await lockDatabaseKey(transaction, ownerUserId);
                    return await operation(new PrismaTextToImageProviderStore(transaction));
                }, {
                    maxWait: 10_000,
                    timeout: 15_000,
                });
            } catch (error) {
                if (!isSqliteBusy(error) || attempt === 5) {
                    throw error;
                }
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, 25 * 2 ** attempt);
                });
            }
        }
        throw new Error("SQLite owner mutation retry 状态不可达");
    }

    /** 所有 owner 均已收敛时安装目标 partial unique，并移除迁移期 trigger。 */
    async finalizeNovelAiConstraint(): Promise<"enforced" | "pending_other_owners"> {
        const installed = await this.client.$queryRawUnsafe<Array<{sql: string | null}>>(`
            SELECT "sql"
            FROM "sqlite_master"
            WHERE "type" = 'index' AND "name" = 'one_novelai_provider_per_owner'
            LIMIT 1
        `);
        if (installed.length > 0) {
            if (!isExpectedNovelAiProviderIndexSql(installed[0]?.sql ?? "")) {
                throw new Error("NovelAI Provider singleton 索引名称已被非目标定义占用；已停止删除过渡 trigger");
            }
            await this.client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "one_novelai_provider_per_owner_insert_transition"`);
            await this.client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "one_novelai_provider_per_owner_update_transition"`);
            return "enforced";
        }
        const duplicates = await this.client.$queryRawUnsafe<Array<{ownerUserId: number}>>(`
            SELECT "ownerUserId"
            FROM "TextToImageProvider"
            WHERE "kind" = 'novelai'
            GROUP BY "ownerUserId"
            HAVING COUNT(*) > 1
            LIMIT 1
        `);
        if (duplicates.length > 0) {
            return "pending_other_owners";
        }
        await this.client.$executeRawUnsafe(`
            CREATE UNIQUE INDEX "one_novelai_provider_per_owner"
            ON "TextToImageProvider" ("ownerUserId")
            WHERE "kind" = 'novelai'
        `);
        await this.client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "one_novelai_provider_per_owner_insert_transition"`);
        await this.client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "one_novelai_provider_per_owner_update_transition"`);
        return "enforced";
    }
}

function toRecord(record: TextToImageProvider): TextToImageProviderRecord {
    return {
        id: record.id,
        ownerUserId: record.ownerUserId,
        kind: record.kind as TextToImageProviderKind,
        name: record.name,
        baseUrl: record.baseUrl,
        model: record.model,
        recipeMigrationModel: record.recipeMigrationModel,
        credentialCiphertext: record.credentialCiphertext,
        credentialIv: record.credentialIv,
        credentialTag: record.credentialTag,
        credentialRevision: z.number().int().positive().safe().parse(record.credentialRevision),
        settings: TextToImageProviderSettingsSchema.parse(record.settings),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

/** 从 App DB 恢复严格类型的 saga；JSON 属于持久化边界，必须先按 schema 验证。 */
function toReconciliationRecord(record: TextToImageProviderReconciliation): TextToImageProviderReconciliationRecord {
    const persisted: unknown = JSON.parse(record.discardedProvidersJson);
    return {
        ownerUserId: record.ownerUserId,
        selectionToken: record.selectionToken,
        keepProviderId: record.keepProviderId,
        discardedProviders: TextToImageProviderSnapshotsSchema.parse(persisted),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

/** 持久层 string 状态在这里收敛为严格 saga 类型。 */
function toRevisionInvalidationRecord(record: TextToImageProviderRevisionInvalidation): TextToImageProviderRevisionInvalidationRecord {
    if (record.state !== "pending" && record.state !== "completed") {
        throw new Error(`未知 Provider revision invalidation 状态：${record.state}`);
    }
    return {
        id: record.id,
        ownerUserId: record.ownerUserId,
        providerId: record.providerId,
        oldRevision: z.number().int().positive().safe().parse(record.oldRevision),
        newRevision: z.number().int().positive().safe().parse(record.newRevision),
        projectId: z.string().trim().min(1).max(200).parse(record.projectId),
        projectPath: z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u).parse(record.projectPath),
        state: record.state,
        attemptCount: z.number().int().nonnegative().safe().parse(record.attemptCount),
        lastError: record.lastError,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

function toDto(record: TextToImageProviderRecord): TextToImageProviderDto {
    return {
        id: record.id,
        kind: "novelai",
        name: record.name,
        baseUrl: record.baseUrl,
        settings: record.settings,
        hasCredential: Boolean(record.credentialCiphertext && record.credentialIv && record.credentialTag),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
}

function toNovelAiDto(record: TextToImageProviderRecord): Extract<TextToImageProviderDto, {kind: "novelai"}> {
    return toDto(record);
}

/** 冻结 Job 与 reconciliation 共用的脱敏 Provider 证据。 */
function toProviderSnapshot(record: TextToImageProviderRecord): TextToImageProviderSnapshotDto {
    if (record.kind !== "novelai") {
        throw new Error("只有 NovelAI Provider 可以生成图片 Job snapshot");
    }
    return {
        ownerUserId: record.ownerUserId,
        providerId: record.id,
        credentialRevision: record.credentialRevision,
        kind: "novelai",
        name: record.name,
        baseUrl: TEXT_TO_IMAGE_NOVELAI_BASE_URL,
        settings: {
            allowPrivateNetwork: false,
            requestIntervalMs: record.settings.requestIntervalMs,
        },
        updatedAt: record.updatedAt.toISOString(),
    };
}

/** 构建脱敏 singleton/preflight DTO；token 绑定完整候选记录但不泄漏 credential。 */
function buildNovelAiInspection(
    ownerUserId: number,
    records: TextToImageProviderRecord[],
    reconciliation: TextToImageProviderReconciliationRecord | null,
): TextToImageNovelAiInspectionDto {
    const ordered = [...records].sort((left, right) => left.id - right.id);
    const candidates = ordered.map((record) => toNovelAiDto(record));
    const recipeMigrationModels = ordered.flatMap((record) => record.recipeMigrationModel
        ? [{providerId: record.id, model: record.recipeMigrationModel}]
        : []);
    if (candidates.length === 0) {
        if (reconciliation) {
            throw new TextToImageProviderReconciliationInProgressError();
        }
        return {state: "unconfigured", provider: null, candidates: [], recipeMigrationModels, selectionToken: null, reconciliationKeepProviderId: null};
    }
    if (candidates.length === 1) {
        if (reconciliation) {
            throw new TextToImageProviderReconciliationInProgressError();
        }
        return {state: "configured", provider: candidates[0] ?? null, candidates, recipeMigrationModels, selectionToken: null, reconciliationKeepProviderId: null};
    }
    if (reconciliation && !candidates.some((candidate) => candidate.id === reconciliation.keepProviderId)) {
        throw new TextToImageProviderReconciliationInProgressError();
    }
    return {
        state: "selection_required",
        provider: null,
        candidates,
        recipeMigrationModels,
        selectionToken: reconciliation?.selectionToken ?? createNovelAiSelectionToken(ownerUserId, ordered),
        reconciliationKeepProviderId: reconciliation?.keepProviderId ?? null,
    };
}

/** selection token 只向前端暴露 SHA-256，输入包含密文材料以检测 token/配置并发变化。 */
function createNovelAiSelectionToken(ownerUserId: number, records: TextToImageProviderRecord[]): string {
    const source = records.map((record) => ({
        id: record.id,
        ownerUserId: record.ownerUserId,
        kind: record.kind,
        name: record.name,
        baseUrl: record.baseUrl,
        model: record.model,
        recipeMigrationModel: record.recipeMigrationModel,
        credentialCiphertext: record.credentialCiphertext,
        credentialIv: record.credentialIv,
        credentialTag: record.credentialTag,
        credentialRevision: record.credentialRevision,
        settings: record.settings,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    }));
    return createHash("sha256").update(JSON.stringify({ownerUserId, records: source}), "utf8").digest("hex");
}

/** Provider ID 集合在第二阶段必须与持久化决定完全一致。 */
function isSameNumberList(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** 每次密钥材料变化只前进一个 revision；溢出时停止写入而不是回绕。 */
function nextCredentialRevision(current: number): number {
    const parsed = z.number().int().positive().safe().parse(current);
    return z.number().int().positive().safe().parse(parsed + 1);
}

function providerNotFoundError() {
    return createError({statusCode: 404, message: "Provider 不存在"});
}

/** 旧数据可能只有 Provider 行但缺少完整 sealed credential，必须在 Job 创建前 fail-closed。 */
function hasProviderCredential(record: TextToImageProviderRecord): boolean {
    return Boolean(record.credentialCiphertext && record.credentialIv && record.credentialTag);
}

/** 统一识别 migration trigger、partial unique index 与 Prisma unique 错误。 */
function isNovelAiSingletonConflict(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("TEXT_TO_IMAGE_NOVELAI_PROVIDER_UNIQUE")
        || message.includes("one_novelai_provider_per_owner");
}

/** SQLite 多 client 同时进入写事务时会立即返回 BUSY；短 App-only mutation 可安全整体重试。 */
function isSqliteBusy(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("SQLITE_BUSY") || message.includes("database is locked");
}
