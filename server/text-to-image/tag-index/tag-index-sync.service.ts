import {
    TagIndexOperationSchema,
    TagIndexSourcePageCacheSchema,
    TagIndexSourcePassSchema,
    TagIndexSourceResourceSchema,
    type TagIndexOperation,
    type TagIndexOperationLease,
    type TagIndexSourcePageCache,
} from "nbook/shared/text-to-image-tag-index";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import type {
    TagSourcePage,
    TagSourceReader,
    TagSourceResource,
} from "nbook/server/text-to-image/tag-index/tag-source-client";
import {TagIndexError, TagIndexErrorCodeSchema} from "nbook/server/text-to-image/tag-index/tag-index-error";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";

const DEFAULT_OPERATION_LEASE_MS = 60_000;
const MAX_PAGES_PER_RESOURCE = 1_000_000;

type TagIndexSyncServiceOptions = {
    store: TagIndexStore;
    sourceClient: TagSourceReader;
    workerId: string;
    idFactory: () => string;
    now?: () => number;
    operationLeaseMs?: number;
    signal?: AbortSignal;
};

/** 持久化 source 两轮同步；本阶段只推进到 source_verified。 */
export class TagIndexSyncService {
    private readonly store: TagIndexStore;
    private readonly sourceClient: TagSourceReader;
    private readonly workerId: string;
    private readonly idFactory: () => string;
    private readonly now: () => number;
    private readonly operationLeaseMs: number;
    private readonly signal: AbortSignal | undefined;

    constructor(options: TagIndexSyncServiceOptions) {
        this.store = options.store;
        this.sourceClient = options.sourceClient;
        this.workerId = options.workerId;
        this.idFactory = options.idFactory;
        this.now = options.now ?? Date.now;
        this.operationLeaseMs = parseLeaseMs(options.operationLeaseMs ?? DEFAULT_OPERATION_LEASE_MS);
        this.signal = options.signal;
    }

    /** 创建或合并用户触发的同步请求；不会在读取状态时联网。 */
    async start(input: {termsConfirmationVersion: string}): Promise<TagIndexOperation> {
        return this.store.startOperation({
            operationId: this.idFactory(),
            termsConfirmationVersion: input.termsConfirmationVersion,
        });
    }

    /** 显式请求取消。 */
    async cancel(operationId: string): Promise<TagIndexOperation> {
        return this.store.cancelOperation(operationId);
    }

    /** 显式重试同一失败 operation，并复用已通过 create-only 校验的 pages。 */
    async retry(operationId: string): Promise<TagIndexOperation> {
        return this.store.retryOperation(operationId);
    }

    /** 领取 operation，完成 source + reconciliation 两轮并冻结 normalized hashes。 */
    async run(operationId: string): Promise<TagIndexOperation> {
        const initial = await this.store.readOperation(operationId);
        if (initial.state === "canceled" || initial.state === "active" || initial.state === "source_verified") return initial;
        let operation: TagIndexOperation;
        try {
            operation = await this.store.claimOperation(operationId, this.workerId, this.operationLeaseMs);
        } catch {
            return this.store.readOperation(operationId);
        }
        if (!operation.lease || operation.state === "canceled" || operation.state === "source_verified") return operation;

        try {
            operation = await this.ensureWatermarks(operation);
            for (const pass of TagIndexSourcePassSchema.options) {
                for (const resource of TagIndexSourceResourceSchema.options) {
                    operation = await this.fetchResource(operation, pass, resource);
                }
            }
            const verifiedHashes = await this.verifyReconciliation(operation.operationId);
            const lease = requireLease(operation);
            const completed = TagIndexOperationSchema.parse({
                ...operation,
                state: "source_verified",
                updatedAt: this.timestamp(),
                lease: null,
                retry: null,
                source: {...operation.source, verifiedHashes},
                error: null,
            });
            return this.store.checkpoint(completed, lease);
        } catch (error) {
            return this.failOperation(operation, error);
        }
    }

    /** 首次领取时冻结三个资源的 upper watermark。 */
    private async ensureWatermarks(operation: TagIndexOperation): Promise<TagIndexOperation> {
        if (operation.source.watermarks) return operation;
        const watermarks = {
            tags: await this.sourceClient.readWatermark("tags", this.signal),
            aliases: await this.sourceClient.readWatermark("aliases", this.signal),
            implications: await this.sourceClient.readWatermark("implications", this.signal),
        };
        if (Object.values(watermarks).some((watermark) => !Number.isSafeInteger(watermark) || watermark <= 0)) {
            throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: "tag source watermark 必须为正安全整数"});
        }
        return this.renewCheckpoint(TagIndexOperationSchema.parse({
            ...operation,
            updatedAt: this.timestamp(),
            source: {...operation.source, watermarks},
        }));
    }

    /** 从持久 cursor 继续抓取一个 pass/resource。 */
    private async fetchResource(
        input: TagIndexOperation,
        pass: "source" | "reconciliation",
        resource: TagSourceResource,
    ): Promise<TagIndexOperation> {
        let operation = input;
        if (operation.source.completedResources[pass].includes(resource)) return operation;
        const watermarks = operation.source.watermarks;
        if (!watermarks) throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: "source watermark 尚未冻结"});
        const watermark = watermarks[resource];

        for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_RESOURCE; pageIndex += 1) {
            const current = await this.store.readOperation(operation.operationId);
            if (current.cancelRequestedAt) return this.finishCanceled(current, requireLease(operation));
            assertSameFence(current.lease, requireLease(operation));
            operation = current;
            const cursor = operation.source.cursors[pass][resource];
            const page = await this.sourceClient.readPage({resource, pass, cursor, watermark, ...(this.signal ? {signal: this.signal} : {})});
            if (page.provenance) {
                await this.store.writeSourcePage(operation, toPageCache(operation.operationId, page));
            }
            if (!page.done && page.nextCursor <= cursor) {
                throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: "tag source cursor 未推进"});
            }
            if (page.done && page.nextCursor !== watermark) {
                throw new TagIndexError({
                    code: "TAG_INDEX_SYNC_INCOMPLETE",
                    message: `${resource}/${pass} 在 frozen watermark 前提前结束`,
                });
            }
            const completedResources = page.done
                ? [...operation.source.completedResources[pass], resource]
                : operation.source.completedResources[pass];
            const nextResource = page.done ? nextSourceResource(resource) : resource;
            const nextPass = page.done && resource === "implications" && pass === "source" ? "reconciliation" : pass;
            operation = await this.renewCheckpoint(TagIndexOperationSchema.parse({
                ...operation,
                updatedAt: this.timestamp(),
                source: {
                    ...operation.source,
                    pass: nextPass,
                    resource: nextResource,
                    cursors: {
                        ...operation.source.cursors,
                        [pass]: {...operation.source.cursors[pass], [resource]: page.nextCursor},
                    },
                    completedResources: {
                        ...operation.source.completedResources,
                        [pass]: completedResources,
                    },
                },
            }));
            if (page.done) return operation;
        }
        throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: `${resource}/${pass} page 数超过安全上限`});
    }

    /** 对两轮 normalized facts 做逐资源完整 hash 比较；未声明资源要求两轮均为空。 */
    private async verifyReconciliation(operationId: string): Promise<{tags: string; aliases: string; implications: string}> {
        const pages = await this.store.readSourcePages(operationId);
        const provided = this.sourceClient.descriptor.providedResources;
        const tags = verifyResourceHash(pages, "tags", provided.includes("tags"));
        const aliases = verifyResourceHash(pages, "aliases", provided.includes("aliases"));
        const implications = verifyResourceHash(pages, "implications", provided.includes("implications"));
        return {tags, aliases, implications};
    }

    /** 续租同一 fence 并持久 checkpoint。 */
    private async renewCheckpoint(operation: TagIndexOperation): Promise<TagIndexOperation> {
        const lease = requireLease(operation);
        const next = TagIndexOperationSchema.parse({
            ...operation,
            lease: {...lease, leaseUntil: new Date(this.now() + this.operationLeaseMs).toISOString()},
        });
        return this.store.checkpoint(next, lease);
    }

    /** 在当前 fence 下把任意失败持久化为 failed；被接管时不得覆盖新 worker。 */
    private async failOperation(operation: TagIndexOperation, error: unknown): Promise<TagIndexOperation> {
        const current = await this.store.readOperation(operation.operationId);
        const lease = operation.lease;
        if (!lease || !sameFence(current.lease, lease)) return current;
        if (current.cancelRequestedAt) return this.finishCanceled(current, lease);
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

    /** 以当前 fence 完成取消。 */
    private async finishCanceled(operation: TagIndexOperation, lease: TagIndexOperationLease): Promise<TagIndexOperation> {
        const canceled = TagIndexOperationSchema.parse({
            ...operation,
            state: "canceled",
            updatedAt: this.timestamp(),
            lease: null,
            retry: null,
            error: null,
        });
        return this.store.checkpoint(canceled, lease);
    }

    /** 当前注入时钟的规范时间。 */
    private timestamp(): string {
        return new Date(this.now()).toISOString();
    }
}

/** 把 SourceClient page 冻结为 create-only cache。 */
function toPageCache(operationId: string, page: TagSourcePage): TagIndexSourcePageCache {
    if (!page.provenance) throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: "非空 source page 缺少 provenance"});
    return TagIndexSourcePageCacheSchema.parse({
        schemaVersion: "nbook.tag-index-source-page/v1",
        operationId,
        resource: page.resource,
        pass: page.provenance.pass,
        provenance: page.provenance,
        records: page.records,
    });
}

/** 比较一个资源两轮的全量 normalized fact hash。 */
function verifyResourceHash(pages: TagIndexSourcePageCache[], resource: TagSourceResource, provided: boolean): string {
    const sourceHash = resourceHash(pages, resource, "source", provided);
    const reconciliationHash = resourceHash(pages, resource, "reconciliation", provided);
    if (sourceHash !== reconciliationHash) {
        throw new TagIndexError({
            code: "TAG_INDEX_RECONCILIATION_FAILED",
            message: `${resource} source/reconciliation facts 不一致`,
        });
    }
    return sourceHash;
}

/** 对一个 pass/resource 的 records 按 ID 稳定排序并检查跨页重复；未声明资源必须为空。 */
function resourceHash(
    pages: TagIndexSourcePageCache[],
    resource: TagSourceResource,
    pass: "source" | "reconciliation",
    provided: boolean,
): string {
    const records = resource === "tags"
        ? pages
            .filter((page): page is Extract<TagIndexSourcePageCache, {resource: "tags"}> => page.resource === "tags" && page.pass === pass)
            .flatMap((page) => page.records)
            .sort((left, right) => left.id - right.id)
        : pages
            .filter((page): page is Extract<TagIndexSourcePageCache, {resource: "aliases" | "implications"}> => page.resource === resource && page.pass === pass)
            .flatMap((page) => page.records)
            .sort((left, right) => left.id - right.id);
    if (!provided) {
        if (records.length > 0) {
            throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: `${resource}/${pass} 声明不提供却出现记录`});
        }
        return hashTextToImageContract({resource, records: []});
    }
    const ids = records.map((record) => record.id);
    if (records.length === 0 || new Set(ids).size !== ids.length) {
        throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: `${resource}/${pass} records 缺失或跨页重复`});
    }
    return hashTextToImageContract({resource, records});
}

/** source resource 的固定顺序。 */
function nextSourceResource(resource: TagSourceResource): TagSourceResource {
    if (resource === "tags") return "aliases";
    if (resource === "aliases") return "implications";
    return "tags";
}

/** 要求 operation 已领取 lease。 */
function requireLease(operation: TagIndexOperation): TagIndexOperationLease {
    if (!operation.lease) throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: "Tag index operation 未持有 lease"});
    return operation.lease;
}

/** 校验持久 operation 仍属于当前 fence。 */
function assertSameFence(current: TagIndexOperationLease | null, expected: TagIndexOperationLease): void {
    if (!sameFence(current, expected)) {
        throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: "Tag index operation fence 已被接管"});
    }
}

/** 比较 owner/version；leaseUntil 允许同 fence 续租。 */
function sameFence(left: TagIndexOperationLease | null, right: TagIndexOperationLease): boolean {
    return Boolean(left && left.ownerId === right.ownerId && left.fencingVersion === right.fencingVersion);
}

/** 只接受稳定领域错误码；其他异常收敛为 source unavailable。 */
function resolveErrorCode(error: unknown): string {
    if (error instanceof TagIndexError) return error.code;
    if (typeof error === "object" && error !== null && "code" in error) {
        const parsed = TagIndexErrorCodeSchema.safeParse(error.code);
        if (parsed.success) return parsed.data;
    }
    return "TAG_INDEX_SOURCE_UNAVAILABLE";
}

/** 对持久 operation 限制错误文案长度。 */
function resolveErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : "Tag index source 同步失败";
    return message.slice(0, 1000) || "Tag index source 同步失败";
}

/** 解析 operation lease 时长。 */
function parseLeaseMs(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1000 || value > 10 * 60_000) {
        throw new Error("operationLeaseMs 必须是 1000..600000 的安全整数");
    }
    return value;
}
