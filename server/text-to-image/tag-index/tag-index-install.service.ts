import {z} from "zod";
import {
    TagIndexOperationSchema,
    TagIndexSourceSnapshotSchema,
    type TagIndexOperation,
    type TagIndexOperationLease,
    type TagIndexSourcePageCache,
    type TagIndexSourceRelationship,
    type TagIndexSourceTag,
} from "nbook/shared/text-to-image-tag-index";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import type {
    TagSourceDescriptor,
    TagSourceReader,
} from "nbook/server/text-to-image/tag-index/tag-source-client";
import {buildTagIndexVersion} from "nbook/server/text-to-image/tag-index/tag-index-builder";
import {TagIndexError, TagIndexErrorCodeSchema} from "nbook/server/text-to-image/tag-index/tag-index-error";
import {normalizeTagIndexSnapshot} from "nbook/server/text-to-image/tag-index/tag-index-normalizer";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";
import {TagIndexSyncService} from "nbook/server/text-to-image/tag-index/tag-index-sync.service";

const DEFAULT_OPERATION_LEASE_MS = 10 * 60_000;

type TagIndexTerms = {
    contentHash: string;
    userConfirmationVersion: string;
    retrievalPolicyVersion: string;
};

type TagIndexInstallServiceOptions = {
    store: TagIndexStore;
    sourceClient: TagSourceReader;
    workerId: string;
    idFactory: () => string;
    capabilityVersion: string;
    terms: TagIndexTerms;
    now?: () => number;
    operationLeaseMs?: number;
    signal?: AbortSignal;
};

/** 把 official 双轮 source、builder 与 current.json CAS 串成一个可恢复安装 operation。 */
export class TagIndexInstallService {
    private readonly store: TagIndexStore;
    private readonly sourceSync: TagIndexSyncService;
    private readonly sourceDescriptor: TagSourceDescriptor;
    private readonly workerId: string;
    private readonly capabilityVersion: string;
    private readonly terms: TagIndexTerms;
    private readonly now: () => number;
    private readonly operationLeaseMs: number;

    constructor(options: TagIndexInstallServiceOptions) {
        this.store = options.store;
        this.sourceDescriptor = options.sourceClient.descriptor;
        this.workerId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/u).parse(options.workerId);
        this.capabilityVersion = z.string().trim().min(1).max(160).parse(options.capabilityVersion);
        this.terms = {
            contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u).parse(options.terms.contentHash),
            userConfirmationVersion: z.string().trim().min(1).max(160).parse(options.terms.userConfirmationVersion),
            retrievalPolicyVersion: z.string().trim().min(1).max(160).parse(options.terms.retrievalPolicyVersion),
        };
        this.now = options.now ?? Date.now;
        this.operationLeaseMs = parseLeaseMs(options.operationLeaseMs ?? DEFAULT_OPERATION_LEASE_MS);
        this.sourceSync = new TagIndexSyncService({
            store: options.store,
            sourceClient: options.sourceClient,
            workerId: this.workerId,
            idFactory: options.idFactory,
            now: this.now,
            operationLeaseMs: this.operationLeaseMs,
            ...(options.signal ? {signal: options.signal} : {}),
        });
    }

    /** 创建或复用当前非终态 operation；网络工作只在调用 run 后发生。 */
    async start(input: {termsConfirmationVersion: string}): Promise<TagIndexOperation> {
        const termsConfirmationVersion = z.string().trim().min(1).max(160).parse(input.termsConfirmationVersion);
        if (termsConfirmationVersion !== this.terms.userConfirmationVersion) {
            throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: "Tag index terms confirmation 已过期"});
        }
        return this.sourceSync.start({termsConfirmationVersion});
    }

    /** 在安全 checkpoint 请求取消；已进入 builder 的同步会在下一阶段边界停止。 */
    async cancel(operationId: string): Promise<TagIndexOperation> {
        return this.sourceSync.cancel(operationId);
    }

    /** 恢复并推进到 active；任一失败都保留原 current.json。 */
    async run(operationId: string): Promise<TagIndexOperation> {
        const sourced = await this.sourceSync.run(operationId);
        if (sourced.state !== "source_verified") return sourced;

        let operation: TagIndexOperation;
        try {
            operation = await this.store.claimOperation(operationId, this.workerId, this.operationLeaseMs);
        } catch {
            return this.store.readOperation(operationId);
        }
        if (!operation.lease) return operation;

        try {
            if (operation.termsConfirmationVersion !== this.terms.userConfirmationVersion) {
                throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: "operation terms confirmation 与当前合同不一致"});
            }
            operation = await this.checkCanceled(operation);
            if (operation.state === "canceled") return operation;
            operation = await this.transition(operation, "normalizing");
            const snapshot = await createSourceSnapshot(this.store, operation, this.sourceDescriptor);
            const normalized = normalizeTagIndexSnapshot({snapshot, capabilityVersion: this.capabilityVersion});

            operation = await this.checkCanceled(operation);
            if (operation.state === "canceled") return operation;
            operation = await this.transition(operation, "indexing", normalized.indexVersion);
            const built = await buildTagIndexVersion({
                root: this.store.root,
                snapshot,
                normalized,
                terms: this.terms,
            });

            operation = await this.checkCanceled(operation);
            if (operation.state === "canceled") return operation;
            operation = await this.transition(operation, "validating", normalized.indexVersion);
            operation = await this.transition(operation, "ready", normalized.indexVersion);
            const activated = await this.store.activateVersion({
                indexVersion: built.manifest.indexVersion,
                manifestHash: built.manifestHash,
                expectedCurrentHash: operation.activePointerHashBeforeStart,
            });
            const lease = requireLease(operation);
            const completed = TagIndexOperationSchema.parse({
                ...operation,
                state: "active",
                updatedAt: this.timestamp(),
                candidateIndexVersion: activated.pointer.indexVersion,
                lease: null,
                retry: null,
                error: null,
            });
            return this.store.checkpoint(completed, lease);
        } catch (error) {
            return this.fail(operation, error);
        }
    }

    /** 续租并冻结当前安装阶段。 */
    private async transition(
        operation: TagIndexOperation,
        state: "normalizing" | "indexing" | "validating" | "ready",
        candidateIndexVersion: string | null = operation.candidateIndexVersion,
    ): Promise<TagIndexOperation> {
        const lease = requireLease(operation);
        const next = TagIndexOperationSchema.parse({
            ...operation,
            state,
            updatedAt: this.timestamp(),
            candidateIndexVersion,
            lease: {...lease, leaseUntil: new Date(this.now() + this.operationLeaseMs).toISOString()},
            retry: null,
            error: null,
        });
        return this.store.checkpoint(next, lease);
    }

    /** cancelRequestedAt 只在完整工件边界转成 terminal canceled。 */
    private async checkCanceled(operation: TagIndexOperation): Promise<TagIndexOperation> {
        const current = await this.store.readOperation(operation.operationId);
        if (!current.cancelRequestedAt) return current;
        const lease = requireLease(current);
        const canceled = TagIndexOperationSchema.parse({
            ...current,
            state: "canceled",
            updatedAt: this.timestamp(),
            lease: null,
            retry: null,
            error: null,
        });
        return this.store.checkpoint(canceled, lease);
    }

    /** 仅当前 fence 可以把 post-source 异常持久化为 failed。 */
    private async fail(operation: TagIndexOperation, error: unknown): Promise<TagIndexOperation> {
        const current = await this.store.readOperation(operation.operationId);
        const lease = current.lease;
        if (!lease || lease.ownerId !== this.workerId) return current;
        const failed = TagIndexOperationSchema.parse({
            ...current,
            state: "failed",
            updatedAt: this.timestamp(),
            lease: null,
            retry: null,
            error: {code: resolveErrorCode(error), message: resolveErrorMessage(error)},
        });
        try {
            return await this.store.checkpoint(failed, lease);
        } catch {
            return this.store.readOperation(operation.operationId);
        }
    }

    /** 使用注入时钟生成规范时间。 */
    private timestamp(): string {
        return new Date(this.now()).toISOString();
    }
}

/** 从 create-only page cache 构造 builder 唯一 source snapshot。 */
async function createSourceSnapshot(store: TagIndexStore, operation: TagIndexOperation, descriptor: TagSourceDescriptor) {
    if (!operation.source.verifiedHashes) {
        throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: "source reconciliation 尚未完成"});
    }
    const pages = await store.readSourcePages(operation.operationId);
    const sourcePages = pages.filter((page) => page.pass === "source");
    const tags = sourceRecords(sourcePages, "tags");
    const aliases = sourceRecords(sourcePages, "aliases");
    const implications = sourceRecords(sourcePages, "implications");
    const factsHash = hashTextToImageContract({tags, aliases, implications});
    return TagIndexSourceSnapshotSchema.parse({
        schemaVersion: "nbook.tag-index-source-snapshot/v1",
        sourceKind: descriptor.kind,
        sourceEndpoint: descriptor.endpoint,
        minPostCount: 3000,
        sourceClientVersion: descriptor.clientVersion,
        providedResources: [...descriptor.providedResources],
        fetchedAt: operation.requestedAt,
        pages: pages.map((page) => page.provenance),
        tags,
        aliases,
        implications,
        sourceHash: factsHash,
        reconciliationHash: factsHash,
    });
}

function sourceRecords(pages: TagIndexSourcePageCache[], resource: "tags"): TagIndexSourceTag[];
function sourceRecords(pages: TagIndexSourcePageCache[], resource: "aliases" | "implications"): TagIndexSourceRelationship[];
/** 按 ID 稳定汇总一个 resource 的 source pass records。 */
function sourceRecords(
    pages: TagIndexSourcePageCache[],
    resource: "tags" | "aliases" | "implications",
): TagIndexSourceTag[] | TagIndexSourceRelationship[] {
    if (resource === "tags") {
        return pages.filter((page): page is Extract<TagIndexSourcePageCache, {resource: "tags"}> => page.resource === "tags")
            .flatMap((page) => page.records)
            .sort((left, right) => left.id - right.id);
    }
    return pages.filter((page): page is Extract<TagIndexSourcePageCache, {resource: "aliases" | "implications"}> => page.resource === resource)
        .flatMap((page) => page.records)
        .sort((left, right) => left.id - right.id);
}

/** 当前安装阶段必须持有 lease。 */
function requireLease(operation: TagIndexOperation): TagIndexOperationLease {
    if (!operation.lease) throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: "Tag index install 未持有 lease"});
    return operation.lease;
}

/** 只保留稳定 Tag index 错误码。 */
function resolveErrorCode(error: unknown): string {
    if (error instanceof TagIndexError) return error.code;
    if (typeof error === "object" && error !== null && "code" in error) {
        const parsed = TagIndexErrorCodeSchema.safeParse(error.code);
        if (parsed.success) return parsed.data;
    }
    return "TAG_INDEX_BUILD_FAILED";
}

/** 错误明文有界持久化。 */
function resolveErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : "Tag index install 失败";
    return message.slice(0, 1000) || "Tag index install 失败";
}

/** 安装 lease 必须覆盖完整本地 builder checkpoint。 */
function parseLeaseMs(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1000 || value > 10 * 60_000) {
        throw new Error("operationLeaseMs 必须是 1000..600000 的安全整数");
    }
    return value;
}
