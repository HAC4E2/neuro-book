import {z} from "zod";
import {stat as statFile} from "node:fs/promises";
import {type Prisma, type PrismaClient} from "nbook/server/generated/project-prisma/client";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    createIllustrationExecutionApprovalHash,
    createIllustrationExecutionManifestHash,
    createTextToImageJobSourceIdentityHash,
    IllustrationCompiledRequestSchema,
    IllustrationExecutionAuthorizationSchema,
    IllustrationExecutionRegistrationReceiptSchema,
    TextToImageJobOriginSchema,
    type IllustrationCompiledRequest,
    type IllustrationExecutionRegistrationReceipt,
} from "nbook/shared/text-to-image-execution";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {
    DispatchPreparationStampSchema,
    type DispatchPreparationStamp,
} from "nbook/shared/text-to-image-dispatch";
import {resolveProjectAbsolutePath} from "nbook/server/text-to-image/compat";
import {resolveReferenceAssetPath} from "nbook/server/text-to-image/asset-path";
import {
    assertTextToImageReferenceMutationScope,
    type TextToImageReferenceMutationScope,
} from "nbook/server/text-to-image/reference-asset-lock";

export const ILLUSTRATION_DISPATCH_REGISTRATION_VERSION = "route-b-dispatch-registration-v3" as const;

const RegistrationInputSchema = z.object({
    projectPath: z.string().regex(/^workspace\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u),
    targetHash: TextToImageContractHashSchema,
    executionNonce: z.string().trim().min(1).max(200),
    executionInputHashes: z.array(TextToImageContractHashSchema).min(1).max(32),
    executionManifestHash: TextToImageContractHashSchema,
    compiledRequests: z.array(IllustrationCompiledRequestSchema).min(1).max(32),
    outputCount: z.number().int().min(1).max(32),
    additionalCostLowerBound: z.number().nonnegative().nullable(),
    tokenLowerBound: z.number().int().nonnegative().nullable(),
    authorization: IllustrationExecutionAuthorizationSchema,
    actorUserId: z.number().int().positive().safe(),
    approvedAt: z.string().datetime(),
}).strict();

export type IllustrationExecutionRegistrationInput = z.infer<typeof RegistrationInputSchema>;

export type IllustrationExecutionRegistrationStage =
    | "manifest_created"
    | "approval_created"
    | "jobs_created"
    | "outbox_created"
    | "lease_verified";

type RegistrationOptions = {
    onStage?: (stage: IllustrationExecutionRegistrationStage) => void | Promise<void>;
    clock?: () => Date;
    transactionTimeoutMs?: number;
};

export type PreparedIllustrationJob = {
    id: string;
    outputIndex: number;
    originJson: string;
    sourceIdentityHash: string;
    idempotencyKey: string;
    dispatchKey: string;
    outboxId: string;
    request: IllustrationCompiledRequest;
};

export type PreparedIllustrationRegistration = {
    input: IllustrationExecutionRegistrationInput;
    preparationId: string;
    manifestId: string;
    approvalId: string;
    approvalHash: string;
    projectId: string;
    jobs: PreparedIllustrationJob[];
};

export type IllustrationExecutionRegistrationErrorCode =
    | "ILLUSTRATION_EXECUTION_REGISTRATION_INVALID"
    | "ILLUSTRATION_EXECUTION_REGISTRATION_CONFLICT";

/** Manifest/Job 注册合同错误；调用方不得在失败后单独补写任何一张表。 */
export class IllustrationExecutionRegistrationError extends Error {
    constructor(readonly code: IllustrationExecutionRegistrationErrorCode, message: string) {
        super(`${code}: ${message}`);
        this.name = "IllustrationExecutionRegistrationError";
    }
}

/** Project SQLite immutable Manifest/approval/Job/outbox 的唯一原子注册入口。 */
export class IllustrationExecutionRepository {
    private readonly onStage?: RegistrationOptions["onStage"];
    private readonly clock: () => Date;
    private readonly transactionTimeoutMs: number;

    constructor(private readonly client: PrismaClient, options: RegistrationOptions = {}) {
        this.onStage = options.onStage;
        this.clock = options.clock ?? (() => new Date());
        this.transactionTimeoutMs = options.transactionTimeoutMs ?? 5_000;
    }

    /** 同一 manifest 或完整 idempotency key 闭集返回已有 receipt，否则单事务全量创建。 */
    async register(
        prepared: PreparedIllustrationRegistration,
        stampInput: DispatchPreparationStamp,
        scope: TextToImageReferenceMutationScope,
    ): Promise<IllustrationExecutionRegistrationReceipt> {
        const stamp = DispatchPreparationStampSchema.parse(stampInput);
        if (stamp.preparationId !== prepared.preparationId) {
            throw invalidRegistration("Project registration 的 preparationId 与稳定注册投影不一致");
        }
        this.assertPrepareLease(stamp);
        assertTextToImageReferenceMutationScope(scope, {
            projectPath: prepared.input.projectPath,
            projectRoot: resolveProjectAbsolutePath(prepared.input.projectPath),
        });
        // 锁内重读：Preview/out-of-lock 编译后参考资产可能已被删除，注册前必须证明闭包仍闭合。
        await this.assertReferencesStillClosed(prepared.input.projectPath, prepared.input.compiledRequests);
        const existing = await this.findExistingReceipt(prepared, stamp);
        if (existing) return existing;
        try {
            await this.client.$transaction(async (transaction) => {
                await transaction.illustrationExecutionManifest.create({
                    data: {
                        id: prepared.manifestId,
                        projectId: prepared.projectId,
                        targetHash: prepared.input.targetHash,
                        executionNonce: prepared.input.executionNonce,
                        executionInputHashesJson: JSON.stringify(prepared.input.executionInputHashes),
                        executionManifestHash: prepared.input.executionManifestHash,
                        recipeSnapshotJson: JSON.stringify(prepared.input.compiledRequests[0]?.recipeSnapshot),
                        compiledRequestsJson: JSON.stringify(prepared.input.compiledRequests),
                        outputCount: prepared.input.outputCount,
                        additionalCostLowerBound: prepared.input.additionalCostLowerBound,
                        tokenLowerBound: prepared.input.tokenLowerBound,
                        registrationState: "jobs_registered",
                    },
                });
                await this.stage("manifest_created");
                await transaction.illustrationExecutionApproval.create({
                    data: {
                        id: prepared.approvalId,
                        manifestId: prepared.manifestId,
                        executionManifestHash: prepared.input.executionManifestHash,
                        approvalHash: prepared.approvalHash,
                        authorizedOutputCount: prepared.input.authorization.authorizedOutputCount,
                        acceptedAdditionalCostLowerBound: prepared.input.authorization.acceptedAdditionalCostLowerBound,
                        acceptedTokenLowerBound: prepared.input.authorization.acceptedTokenLowerBound,
                        actorUserId: prepared.input.actorUserId,
                        approvedAt: new Date(prepared.input.approvedAt),
                    },
                });
                await this.stage("approval_created");
                await transaction.textToImageJob.createMany({
                    data: prepared.jobs.map((job) => ({
                        id: job.id,
                        providerId: job.request.provider.providerId,
                        kind: "illustration",
                        status: "queued",
                        sourcePath: job.request.source.chapterPath,
                        sourceAnchorId: job.request.source.placeholderId,
                        sourceInsertStatus: "pending",
                        providerSnapshotJson: JSON.stringify(job.request.provider),
                        requestJson: JSON.stringify(job.request),
                        originJson: job.originJson,
                        sourceIdentityHash: job.sourceIdentityHash,
                        providerOwnerUserId: job.request.provider.ownerUserId,
                        providerCredentialRevision: job.request.provider.credentialRevision,
                        executionManifestId: prepared.manifestId,
                        executionApprovalId: prepared.approvalId,
                        compiledRequestHash: job.request.compiledRequestHash,
                        idempotencyKey: job.idempotencyKey,
                        variantIndex: 0,
                        outputIndex: job.outputIndex,
                        resultAssetIdsJson: "[]",
                    })),
                });
                await this.stage("jobs_created");
                await transaction.textToImageDispatchOutbox.createMany({
                    data: prepared.jobs.map((job) => ({
                        id: job.outboxId,
                        dispatchKey: job.dispatchKey,
                        jobId: job.id,
                        manifestId: prepared.manifestId,
                        manifestHash: prepared.input.executionManifestHash,
                        registrationVersion: ILLUSTRATION_DISPATCH_REGISTRATION_VERSION,
                        preparationId: stamp.preparationId,
                        prepareAttemptId: stamp.prepareAttemptId,
                        prepareVersion: stamp.prepareVersion,
                        state: "pending",
                    })),
                });
                await this.stage("outbox_created");
                this.assertPrepareLease(stamp);
                await this.stage("lease_verified");
            }, {maxWait: 1_000, timeout: this.transactionTimeoutMs});
        } catch (error) {
            const converged = await this.findExistingReceipt(prepared, stamp);
            if (converged) return converged;
            throw error;
        }
        const receipt = await this.readReceipt(prepared.manifestId, stamp);
        if (!receipt) {
            throw new IllustrationExecutionRegistrationError(
                "ILLUSTRATION_EXECUTION_REGISTRATION_CONFLICT",
                "注册事务已返回但完整 receipt 不可见",
            );
        }
        return receipt;
    }

    /** 先按 manifest 收敛，再按完整 idempotency key 闭集恢复已有付费请求。 */
    private async findExistingReceipt(
        prepared: PreparedIllustrationRegistration,
        stamp: DispatchPreparationStamp,
    ): Promise<IllustrationExecutionRegistrationReceipt | null> {
        const manifest = await this.client.illustrationExecutionManifest.findUnique({
            where: {executionManifestHash: prepared.input.executionManifestHash},
            select: {id: true},
        });
        if (manifest) {
            const receipt = await this.readReceipt(manifest.id, stamp);
            if (receipt) return receipt;
            const rebound = await this.rebindOlderReceipt(prepared, stamp, manifest.id);
            if (rebound) return rebound;
            throw new IllustrationExecutionRegistrationError(
                "ILLUSTRATION_EXECUTION_REGISTRATION_CONFLICT",
                "相同 manifestHash 已存在但注册闭包不完整",
            );
        }
        const jobs = await this.client.textToImageJob.findMany({
            where: {idempotencyKey: {in: prepared.jobs.map((job) => job.idempotencyKey)}},
            select: {idempotencyKey: true, executionManifestId: true},
        });
        if (jobs.length === 0) return null;
        const expectedKeys = new Set(prepared.jobs.map((job) => job.idempotencyKey));
        const manifestIds = new Set(jobs.map((job) => job.executionManifestId).filter((id): id is string => id !== null));
        if (jobs.length !== expectedKeys.size
            || jobs.some((job) => !job.idempotencyKey || !expectedKeys.has(job.idempotencyKey))
            || manifestIds.size !== 1) {
            throw new IllustrationExecutionRegistrationError(
                "ILLUSTRATION_EXECUTION_REGISTRATION_CONFLICT",
                "idempotency key 只命中部分 Job 或跨越多个 Manifest",
            );
        }
        const manifestId = manifestIds.values().next().value;
        if (typeof manifestId !== "string") {
            throw new IllustrationExecutionRegistrationError(
                "ILLUSTRATION_EXECUTION_REGISTRATION_CONFLICT",
                "已存在 Job 缺少 execution manifest identity",
            );
        }
        const receipt = await this.readReceipt(manifestId, stamp);
        if (receipt) return receipt;
        const rebound = await this.rebindOlderReceipt(prepared, stamp, manifestId);
        if (!rebound) {
            throw new IllustrationExecutionRegistrationError(
                "ILLUSTRATION_EXECUTION_REGISTRATION_CONFLICT",
                "idempotent Job 所属注册闭包不完整",
            );
        }
        return rebound;
    }

    /** 晚到的旧 Project commit 只有在 immutable 闭包完整且版本统一更旧时，才能原子重绑当前 prepare stamp。 */
    private async rebindOlderReceipt(
        prepared: PreparedIllustrationRegistration,
        stamp: DispatchPreparationStamp,
        manifestId: string,
    ): Promise<IllustrationExecutionRegistrationReceipt | null> {
        return await this.client.$transaction(async (transaction) => {
            const manifest = await transaction.illustrationExecutionManifest.findUnique({where: {id: manifestId}});
            if (!manifest
                || manifest.executionManifestHash !== prepared.input.executionManifestHash
                || manifest.projectId !== prepared.projectId
                || manifest.outputCount !== prepared.jobs.length
                || manifest.registrationState !== "jobs_registered") {
                return null;
            }
            const [approval, jobs, outboxes] = await Promise.all([
                transaction.illustrationExecutionApproval.findUnique({
                    where: {manifestId},
                    select: {id: true, approvalHash: true},
                }),
                transaction.textToImageJob.findMany({
                    where: {executionManifestId: manifestId},
                    orderBy: [{outputIndex: "asc"}, {id: "asc"}],
                    select: {id: true, idempotencyKey: true, compiledRequestHash: true},
                }),
                transaction.textToImageDispatchOutbox.findMany({where: {manifestId}}),
            ]);
            if (!approval
                || approval.id !== prepared.approvalId
                || approval.approvalHash !== prepared.approvalHash
                || jobs.length !== prepared.jobs.length
                || outboxes.length !== prepared.jobs.length) return null;
            const expectedJobs = new Map(prepared.jobs.map((job) => [job.id, job]));
            if (jobs.some((job) => {
                const expected = expectedJobs.get(job.id);
                return !expected
                    || job.idempotencyKey !== expected.idempotencyKey
                    || job.compiledRequestHash !== expected.request.compiledRequestHash;
            })) return null;
            const outboxByJob = new Map(outboxes.map((outbox) => [outbox.jobId, outbox]));
            const orderedOutboxes = prepared.jobs.map((job) => outboxByJob.get(job.id));
            if (orderedOutboxes.some((outbox) => !outbox)) return null;
            const exactOutboxes = orderedOutboxes.filter((outbox): outbox is NonNullable<typeof outbox> => Boolean(outbox));
            const oldVersions = new Set(exactOutboxes.map((outbox) => outbox.prepareVersion));
            const oldAttempts = new Set(exactOutboxes.map((outbox) => outbox.prepareAttemptId));
            if (exactOutboxes.some((outbox, index) => outbox.dispatchKey !== prepared.jobs[index]?.dispatchKey
                || outbox.registrationVersion !== ILLUSTRATION_DISPATCH_REGISTRATION_VERSION
                || outbox.preparationId !== stamp.preparationId
                || outbox.prepareVersion === null
                || outbox.prepareAttemptId === null
                || outbox.prepareVersion >= stamp.prepareVersion)
                || oldVersions.size !== 1
                || oldAttempts.size !== 1) {
                return null;
            }
            const oldVersion = exactOutboxes[0]?.prepareVersion;
            const oldAttempt = exactOutboxes[0]?.prepareAttemptId;
            if (oldVersion === undefined || oldVersion === null || oldAttempt === undefined || oldAttempt === null) return null;
            const updated = await transaction.textToImageDispatchOutbox.updateMany({
                where: {
                    manifestId,
                    preparationId: stamp.preparationId,
                    prepareVersion: oldVersion,
                    prepareAttemptId: oldAttempt,
                },
                data: {prepareAttemptId: stamp.prepareAttemptId, prepareVersion: stamp.prepareVersion},
            });
            if (updated.count !== prepared.jobs.length) return null;
            return await this.readReceipt(manifestId, stamp, transaction);
        }, {maxWait: 1_000, timeout: this.transactionTimeoutMs});
    }

    /** 从四张表重建稳定 receipt；任一缺失返回 null。 */
    private async readReceipt(
        manifestId: string,
        stamp: DispatchPreparationStamp,
        client: PrismaClient | Prisma.TransactionClient = this.client,
    ): Promise<IllustrationExecutionRegistrationReceipt | null> {
        const manifest = await client.illustrationExecutionManifest.findUnique({where: {id: manifestId}});
        if (!manifest || manifest.registrationState !== "jobs_registered") return null;
        const [approval, jobs, outboxes] = await Promise.all([
            client.illustrationExecutionApproval.findUnique({where: {manifestId}}),
            client.textToImageJob.findMany({
                where: {executionManifestId: manifestId},
                orderBy: [{outputIndex: "asc"}, {id: "asc"}],
                select: {id: true, outputIndex: true},
            }),
            client.textToImageDispatchOutbox.findMany({where: {manifestId}}),
        ]);
        if (!approval || jobs.length !== manifest.outputCount || outboxes.length !== manifest.outputCount) return null;
        if (outboxes.some((outbox) => outbox.registrationVersion !== ILLUSTRATION_DISPATCH_REGISTRATION_VERSION
            || outbox.preparationId !== stamp.preparationId
            || outbox.prepareAttemptId !== stamp.prepareAttemptId
            || outbox.prepareVersion !== stamp.prepareVersion)) {
            return null;
        }
        const dispatchByJob = new Map(outboxes.map((outbox) => [outbox.jobId, outbox.dispatchKey]));
        const dispatchKeys = jobs.map((job) => dispatchByJob.get(job.id));
        if (dispatchKeys.some((dispatchKey) => !dispatchKey)) return null;
        return IllustrationExecutionRegistrationReceiptSchema.parse({
            schemaVersion: "nbook.illustration-execution-registration-receipt/v1",
            manifestId: manifest.id,
            executionManifestHash: manifest.executionManifestHash,
            approvalId: approval.id,
            approvalHash: approval.approvalHash,
            registrationState: "jobs_registered",
            dispatchState: "dispatch_pending",
            jobIds: jobs.map((job) => job.id),
            dispatchKeys,
            registeredAt: manifest.createdAt.toISOString(),
        });
    }

    /** 测试 hook 也位于 transaction callback 内，确保异常由 SQLite 全量回滚。 */
    private async stage(stage: IllustrationExecutionRegistrationStage): Promise<void> {
        await this.onStage?.(stage);
    }

    /**
     * 锁内重读：CompiledRequests 引用的每个参考资产行必须仍存在且 status available，
     * 文件大小必须与登记证据一致。任何缺失/篡改都拒绝注册，绝不创建悬空 Manifest。
     */
    private async assertReferencesStillClosed(
        projectPath: string,
        requests: IllustrationCompiledRequest[],
    ): Promise<void> {
        const hashes = new Set<string>();
        for (const request of requests) {
            for (const reference of request.references.vibeReferences) hashes.add(reference.contentHash);
            for (const reference of request.references.characterReferences) hashes.add(reference.contentHash);
            if (request.references.inpaint) {
                hashes.add(request.references.inpaint.baseImageContentHash);
                hashes.add(request.references.inpaint.maskContentHash);
            }
        }
        if (hashes.size === 0) return;
        const rows = await this.client.textToImageReferenceAsset.findMany({
            where: {contentHash: {in: [...hashes]}},
            select: {contentHash: true, relativePath: true, byteLength: true, width: true, height: true, mimeType: true},
        });
        if (rows.length !== hashes.size) {
            throw invalidRegistration("参考资产在授权后已消失，禁止创建悬空 Manifest");
        }
        const projectRoot = resolveProjectAbsolutePath(projectPath);
        for (const row of rows) {
            const absolutePath = resolveReferenceAssetPath(projectRoot, row.relativePath);
            try {
                const fileStat = await statFile(absolutePath);
                if (!fileStat.isFile() || fileStat.size !== row.byteLength) {
                    throw invalidRegistration("参考资产文件与登记证据不一致，禁止注册");
                }
            } catch (error) {
                if (isMissingFileError(error)) {
                    throw invalidRegistration("参考资产文件已缺失，禁止创建悬空 Manifest");
                }
                throw error;
            }
        }
    }

    /** Project 事务开始前与提交前都必须仍持有 App prepare lease。 */
    private assertPrepareLease(stamp: DispatchPreparationStamp): void {
        const now = this.clock();
        if (Number.isNaN(now.getTime()) || now.getTime() >= new Date(stamp.prepareLeaseUntil).getTime()) {
            throw new IllustrationExecutionRegistrationError(
                "ILLUSTRATION_EXECUTION_REGISTRATION_CONFLICT",
                "App prepare lease 已失效，Project transaction 不得提交",
            );
        }
    }
}

/** 严格复验 manifest、预算、owner 与各 output，并生成稳定注册 identities。 */
export function prepareIllustrationExecutionRegistration(
    rawInput: IllustrationExecutionRegistrationInput,
): PreparedIllustrationRegistration {
    const input = RegistrationInputSchema.parse(rawInput);
    const first = input.compiledRequests[0];
    if (!first
        || input.executionInputHashes.length !== input.outputCount
        || input.compiledRequests.length !== input.outputCount
        || input.authorization.authorizedOutputCount !== input.outputCount) {
        throw invalidRegistration("outputCount、authorization 与请求/hash 数量必须完全一致");
    }
    if (input.additionalCostLowerBound !== null
        && (input.authorization.acceptedAdditionalCostLowerBound === null
            || input.authorization.acceptedAdditionalCostLowerBound < input.additionalCostLowerBound)) {
        throw invalidRegistration("授权费用下界低于 Preview 冻结的费用下界");
    }
    if (input.tokenLowerBound !== null
        && (input.authorization.acceptedTokenLowerBound === null
            || input.authorization.acceptedTokenLowerBound < input.tokenLowerBound)) {
        throw invalidRegistration("授权 Token 下界低于 Preview 下限");
    }
    const projectId = first.source.projectId;
    const providerIdentity = hashTextToImageContract(first.provider);
    const recipeIdentity = hashTextToImageContract(first.recipeSnapshot);
    if (first.provider.ownerUserId !== input.actorUserId
        || input.compiledRequests.some((request) => request.source.projectId !== projectId
            || request.provider.ownerUserId !== input.actorUserId
            || hashTextToImageContract(request.provider) !== providerIdentity
            || hashTextToImageContract(request.recipeSnapshot) !== recipeIdentity)) {
        throw invalidRegistration("CompiledRequests 必须共享当前 actor owner、Project、Provider 与 Recipe snapshot");
    }
    const manifestHash = createIllustrationExecutionManifestHash({
        executionInputHashes: input.executionInputHashes,
        recipeSnapshot: first.recipeSnapshot,
        compiledRequests: input.compiledRequests,
        outputCount: input.outputCount,
        additionalCostLowerBound: input.additionalCostLowerBound,
        tokenLowerBound: input.tokenLowerBound,
    });
    if (manifestHash !== input.executionManifestHash) throw invalidRegistration("executionManifestHash 与注册内容不一致");
    const manifestId = stableId("illustration-manifest", input.executionManifestHash);
    const approvalHash = createIllustrationExecutionApprovalHash({
        executionManifestHash: input.executionManifestHash,
        authorization: input.authorization,
        actorUserId: input.actorUserId,
        approvedAt: input.approvedAt,
    });
    const approvalId = stableId("illustration-approval", hashTextToImageContract({
        executionManifestHash: input.executionManifestHash,
        actorUserId: input.actorUserId,
    }));
    const jobs = input.compiledRequests.map((request, outputIndex): PreparedIllustrationJob => {
        const origin = TextToImageJobOriginSchema.parse({
            kind: "button",
            chapterPath: request.source.chapterPath,
            placeholderId: request.source.placeholderId,
            shotId: request.source.shotId,
            shotOrigin: request.source.shotOrigin,
        });
        const sourceIdentityHash = createTextToImageJobSourceIdentityHash(origin);
        const idempotencyKey = hashTextToImageContract({
            schemaVersion: "nbook.text-to-image-job-idempotency/v1",
            providerOwnerUserId: request.provider.ownerUserId,
            providerId: request.provider.providerId,
            providerCredentialRevision: request.provider.credentialRevision,
            projectPath: input.projectPath,
            sourceIdentityHash,
            variantIndex: 0,
            compiledRequestHash: request.compiledRequestHash,
        });
        const jobId = stableId("illustration-job", idempotencyKey);
        const dispatchKey = hashTextToImageContract({
            schemaVersion: "nbook.text-to-image-dispatch-key/v2",
            jobId,
            registrationVersion: ILLUSTRATION_DISPATCH_REGISTRATION_VERSION,
        });
        return {
            id: jobId,
            outputIndex,
            originJson: JSON.stringify(origin),
            sourceIdentityHash,
            idempotencyKey,
            dispatchKey,
            outboxId: stableId("illustration-outbox", dispatchKey),
            request,
        };
    });
    if (new Set(jobs.map((job) => job.sourceIdentityHash)).size !== jobs.length) {
        throw invalidRegistration("同一 Manifest 不能重复注册相同 button source identity");
    }
    const preparationId = stableId("dispatch-preparation", hashTextToImageContract({
        schemaVersion: "nbook.text-to-image-dispatch-preparation-identity/v1",
        ownerUserId: first.provider.ownerUserId,
        providerId: first.provider.providerId,
        providerCredentialRevision: first.provider.credentialRevision,
        projectId,
        projectPath: input.projectPath,
        jobIds: jobs.map((job) => job.id),
        dispatchKeys: jobs.map((job) => job.dispatchKey),
    }));
    return {input, preparationId, manifestId, approvalId, approvalHash, projectId, jobs};
}

/** 从 contract hash 生成不依赖随机数的稳定 ID。 */
function stableId(prefix: string, contractHash: string): string {
    const hash = TextToImageContractHashSchema.parse(contractHash);
    return `${prefix}-${hash.slice("sha256:".length, "sha256:".length + 32)}`;
}

/** 构造稳定注册输入错误。 */
function invalidRegistration(message: string): IllustrationExecutionRegistrationError {
    return new IllustrationExecutionRegistrationError("ILLUSTRATION_EXECUTION_REGISTRATION_INVALID", message);
}

/** 只消费 ENOENT，其他文件错误保持原样。 */
function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
