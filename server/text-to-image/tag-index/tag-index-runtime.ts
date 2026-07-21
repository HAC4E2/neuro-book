import {randomUUID} from "node:crypto";
import {
    DANBOORU_MIN_POST_COUNT,
    TAG_INDEX_CAPABILITY_VERSION,
    TAG_INDEX_RETRIEVAL_POLICY_VERSION,
    TAG_INDEX_TERMS_CONFIRMATION_VERSION,
    TagIndexSearchResponseSchema,
    TagIndexStatusSchema,
    TagIndexSyncRequestSchema,
    type TagIndexActiveSummary,
    type TagIndexOperation,
    type TagIndexSearchRequest,
    type TagIndexSearchResponse,
    type TagIndexStatus,
    type TagIndexSyncRequest,
} from "nbook/shared/text-to-image-tag-index";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    DANBOORU_SOURCE_ENDPOINT,
    DanbooruSourceClient,
    type DanbooruSourceReader,
    type DanbooruSourceRetry,
} from "nbook/server/text-to-image/tag-index/danbooru-source-client";
import {TagIndexInstallService} from "nbook/server/text-to-image/tag-index/tag-index-install.service";
import {TagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";
import {TagIndexReader} from "nbook/server/text-to-image/tag-index/tag-index-reader";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";

export const TAG_INDEX_TERMS_STATEMENT = "仅在用户显式确认后，从 Danbooru 官方 JSON API 同步 post_count >= 3000 的 Tag 及相关 active Alias/Implication；索引保留官方归属信息，不接收 Chatu8 tagData 或任意第三方来源。" as const;
export const TAG_INDEX_TERMS_CONTENT_HASH = hashTextToImageContract({
    sourceEndpoint: DANBOORU_SOURCE_ENDPOINT,
    termsUrl: "https://danbooru.donmai.us/terms_of_service",
    attributionUrl: "https://danbooru.donmai.us/",
    minPostCount: DANBOORU_MIN_POST_COUNT,
    confirmationVersion: TAG_INDEX_TERMS_CONFIRMATION_VERSION,
    retrievalPolicyVersion: TAG_INDEX_RETRIEVAL_POLICY_VERSION,
    statement: TAG_INDEX_TERMS_STATEMENT,
});

type RuntimeJob = {
    controller: AbortController;
    promise: Promise<void>;
};

type TagIndexRuntimeOptions = {
    root?: string;
    createSourceClient?: (input: {
        onRetry: (retry: DanbooruSourceRetry | null) => Promise<void>;
    }) => DanbooruSourceReader;
};

/** Workspace Root Tag index 的进程内编排器；持久真相仍全部位于 TagIndexStore。 */
export class TagIndexRuntime {
    private readonly store: TagIndexStore;
    private readonly reader: TagIndexReader;
    private readonly createSourceClient: NonNullable<TagIndexRuntimeOptions["createSourceClient"]>;
    private readonly jobs = new Map<string, RuntimeJob>();

    constructor(options: TagIndexRuntimeOptions = {}) {
        this.store = new TagIndexStore(options.root ? {root: options.root} : {});
        this.reader = new TagIndexReader({root: this.store.root});
        this.createSourceClient = options.createSourceClient
            ?? ((input) => new DanbooruSourceClient({onRetry: input.onRetry}));
    }

    /** 只读本地状态；绝不因页面打开访问 official source。 */
    async status(): Promise<TagIndexStatus> {
        const [activePointer, operation] = await Promise.all([
            this.store.readActivePointer(),
            this.store.readActiveOperation(),
        ]);
        const active = activePointer ? summarizeActive(await this.reader.readActiveContext()) : null;
        const pages = operation ? await this.store.readSourcePages(operation.operationId) : [];
        const operationInProgress = operation !== null && !["active", "failed", "canceled"].includes(operation.state);
        return TagIndexStatusSchema.parse({
            schemaVersion: "nbook.tag-index-status/v1",
            source: {kind: "danbooru-api", endpoint: DANBOORU_SOURCE_ENDPOINT, minPostCount: DANBOORU_MIN_POST_COUNT},
            terms: {
                confirmationVersion: TAG_INDEX_TERMS_CONFIRMATION_VERSION,
                retrievalPolicyVersion: TAG_INDEX_RETRIEVAL_POLICY_VERSION,
                contentHash: TAG_INDEX_TERMS_CONTENT_HASH,
                termsUrl: "https://danbooru.donmai.us/terms_of_service",
                attributionUrl: "https://danbooru.donmai.us/",
                statement: TAG_INDEX_TERMS_STATEMENT,
            },
            active,
            operation,
            progress: operation ? {
                pageCount: pages.length,
                recordCount: pages.reduce((total, page) => total + page.records.length, 0),
            } : null,
            oldActiveContinuing: Boolean(active && operationInProgress),
        });
    }

    /** 校验当前条款确认，创建/恢复唯一 operation，并在后台推进。 */
    async start(input: TagIndexSyncRequest): Promise<TagIndexOperation> {
        const request = TagIndexSyncRequestSchema.parse(input);
        if (request.termsContentHash !== TAG_INDEX_TERMS_CONTENT_HASH) {
            throw new TagIndexError({code: "TAG_INDEX_SYNC_INCOMPLETE", message: "Tag index terms content 已变化，请重新确认"});
        }
        const existing = await this.store.readActiveOperation();
        let operation: TagIndexOperation;
        if (existing && (existing.state === "failed" || existing.state === "canceled")
            && existing.termsConfirmationVersion === request.termsConfirmationVersion) {
            operation = await this.store.retryOperation(existing.operationId);
        } else {
            operation = await this.store.startOperation({
                operationId: `tag-sync-${randomUUID()}`,
                termsConfirmationVersion: request.termsConfirmationVersion,
            });
        }
        this.launch(operation);
        return operation;
    }

    /** 请求持久取消，并中止当前 official HTTP attempt。 */
    async cancel(operationId: string): Promise<TagIndexOperation> {
        const operation = await this.store.cancelOperation(operationId);
        this.jobs.get(operationId)?.controller.abort();
        return operation;
    }

    /** 读取指定 operation，供轮询路由核对稳定 identity。 */
    async operation(operationId: string): Promise<TagIndexOperation> {
        return this.store.readOperation(operationId);
    }

    /** 只查询 active SQLite；sync 失败或取消时仍由旧 current.json 服务。 */
    async search(input: TagIndexSearchRequest): Promise<TagIndexSearchResponse> {
        return TagIndexSearchResponseSchema.parse(await this.reader.search(input));
    }

    /** 测试/优雅关闭可等待指定后台 operation；生产 API 不调用。 */
    async wait(operationId: string): Promise<void> {
        await this.jobs.get(operationId)?.promise;
    }

    /** 同一 operation 在当前进程只启动一个 worker；持久 lease 继续防跨进程重复。 */
    private launch(operation: TagIndexOperation): void {
        if (["active", "failed", "canceled"].includes(operation.state) || this.jobs.has(operation.operationId)) return;
        const controller = new AbortController();
        const workerId = `tag-worker-${randomUUID()}`;
        const sourceClient = this.createSourceClient({
            onRetry: async (retry) => {
                await this.store.updateRetry(operation.operationId, workerId, retry ? {
                    reason: retry.reason,
                    attempt: retry.attempt,
                    retryAt: new Date(Date.now() + retry.delayMs).toISOString(),
                } : null);
            },
        });
        const install = new TagIndexInstallService({
            store: this.store,
            sourceClient,
            workerId,
            idFactory: () => operation.operationId,
            capabilityVersion: TAG_INDEX_CAPABILITY_VERSION,
            terms: {
                contentHash: TAG_INDEX_TERMS_CONTENT_HASH,
                userConfirmationVersion: TAG_INDEX_TERMS_CONFIRMATION_VERSION,
                retrievalPolicyVersion: TAG_INDEX_RETRIEVAL_POLICY_VERSION,
            },
            signal: controller.signal,
        });
        const promise = install.run(operation.operationId)
            .then(() => undefined)
            .finally(() => {
                if (this.jobs.get(operation.operationId)?.promise === promise) this.jobs.delete(operation.operationId);
            });
        this.jobs.set(operation.operationId, {controller, promise});
    }
}

/** 把完整 manifest 投影为设置页所需的有限只读摘要。 */
function summarizeActive(context: Awaited<ReturnType<TagIndexReader["readActiveContext"]>>): TagIndexActiveSummary {
    const artifact = (kind: "tags_core" | "tags_high" | "tags_common" | "tags_tail") => {
        const found = context.manifest.artifacts.find((candidate) => candidate.kind === kind);
        if (!found) throw new Error(`active Tag index 缺少 ${kind} 工件`);
        return {count: found.recordCount, hash: found.hash};
    };
    return {
        indexVersion: context.pointer.indexVersion,
        manifestHash: context.manifestHash,
        activatedAt: context.pointer.activatedAt,
        fetchedAt: context.manifest.fetchedAt,
        snapshotDate: context.manifest.snapshotDate,
        watermarks: {
            tags: context.manifest.resources.tags.watermark,
            aliases: context.manifest.resources.aliases.watermark,
            implications: context.manifest.resources.implications.watermark,
        },
        counts: {
            mainTags: context.manifest.counts.mainTagCount,
            deprecatedTags: context.manifest.counts.deprecatedTagCount,
            aliases: context.manifest.counts.aliasCount,
            implications: context.manifest.counts.implicationCount,
        },
        tiers: {
            core: artifact("tags_core"),
            high: artifact("tags_high"),
            common: artifact("tags_common"),
            tail: artifact("tags_tail"),
        },
        validation: context.manifest.validation,
    };
}

let runtime: TagIndexRuntime | null = null;

/** Nitro 进程内唯一 runtime；文件 lease/CAS 仍负责多进程正确性。 */
export function getTagIndexRuntime(): TagIndexRuntime {
    runtime ??= new TagIndexRuntime();
    return runtime;
}
