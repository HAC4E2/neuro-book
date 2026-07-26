import {z} from "zod";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";
import {PROVIDER_CAPABILITY_REGISTRY_VERSION} from "nbook/shared/text-to-image-provider-registry";

export const DANBOORU_MIN_POST_COUNT = 3000 as const;
/** 索引数据源：随应用打包的本地 TTP tagData（Danbooru 标签衍生数据），不联网抓取。 */
export const TAG_INDEX_SOURCE_KIND = "ttp-local" as const;
/** 本地源没有网络 endpoint；固定标识符用于 manifest/status 溯源。 */
export const TAG_INDEX_SOURCE_ENDPOINT = "local:ttp-tagdata" as const;
export const TAG_INDEX_MANIFEST_SCHEMA_VERSION = "nbook.tag-index-manifest/v1" as const;
export const TAG_INDEX_CURRENT_SCHEMA_VERSION = "nbook.tag-index-current/v1" as const;
export const TAG_INDEX_SOURCE_SNAPSHOT_SCHEMA_VERSION = "nbook.tag-index-source-snapshot/v1" as const;
export const TAG_INDEX_OPERATION_SCHEMA_VERSION = "nbook.tag-index-operation/v1" as const;
export const TAG_INDEX_BUILD_REPORT_SCHEMA_VERSION = "nbook.tag-index-build-report/v1" as const;
export const TAG_INDEX_STATUS_SCHEMA_VERSION = "nbook.tag-index-status/v1" as const;
export const TAG_INDEX_TERMS_CONFIRMATION_VERSION = "ttp-local-terms-2026-07-v1" as const;
export const TAG_INDEX_RETRIEVAL_POLICY_VERSION = "nbook-danbooru-retrieval-v1" as const;
export const TAG_INDEX_CAPABILITY_VERSION = PROVIDER_CAPABILITY_REGISTRY_VERSION;

const StableVersionSchema = z.string().trim().min(1).max(160);
const StableIdentitySchema = z.string().trim().min(1).max(240);
/** 官方已验证 Tag name：1..170 个可打印 ASCII、无空白或逗号。 */
const CanonicalTagNameSchema = z.string().regex(/^[\x21-\x2b\x2d-\x7e]{1,170}$/u);
const IsoTimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u);
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const SafeCountSchema = z.number().int().nonnegative().safe();
const PositiveIdSchema = z.number().int().positive().safe();

export const DanbooruTagCategorySchema = z.enum([
    "general",
    "artist",
    "copyright",
    "character",
    "meta",
]);
export type DanbooruTagCategory = z.infer<typeof DanbooruTagCategorySchema>;

export const TagUsageTierSchema = z.enum(["core", "high", "common", "tail"]);
export type TagUsageTier = z.infer<typeof TagUsageTierSchema>;

/** 把官方 category ID 收窄为冻结的类别联合；未知类别视为上游 schema 变化。 */
export function resolveDanbooruCategory(categoryId: number): DanbooruTagCategory {
    switch (categoryId) {
        case 0: return "general";
        case 1: return "artist";
        case 3: return "copyright";
        case 4: return "character";
        case 5: return "meta";
        default: throw new Error(`未知 Danbooru category：${categoryId}`);
    }
}

/** 按冻结 3K+ 合同计算唯一 usage tier；阈值外返回 null。 */
export function resolveTagUsageTier(postCount: number): TagUsageTier | null {
    if (!Number.isSafeInteger(postCount) || postCount < DANBOORU_MIN_POST_COUNT) return null;
    if (postCount >= 100000) return "core";
    if (postCount >= 30000) return "high";
    if (postCount >= 10000) return "common";
    return "tail";
}

/** 3K+ 未 deprecated 主集合记录；每条必须且只能属于一个 tier。 */
export const TagIndexTagRecordSchema = z.object({
    tagId: PositiveIdSchema,
    canonicalName: CanonicalTagNameSchema,
    category: DanbooruTagCategorySchema,
    postCount: SafeCountSchema,
    usageTier: TagUsageTierSchema,
    isDeprecated: z.literal(false),
    providerCompatibility: z.literal("generic-novelai"),
    sourceUpdatedAt: IsoTimestampSchema,
}).strict().superRefine((record, context) => {
    const expectedTier = resolveTagUsageTier(record.postCount);
    if (expectedTier !== record.usageTier) {
        context.addIssue({
            code: "custom",
            path: ["usageTier"],
            message: "usageTier 必须与冻结 postCount 边界一致",
        });
    }
});
export type TagIndexTagRecord = z.infer<typeof TagIndexTagRecordSchema>;

/** 3K+ deprecated 记录只作解析证据，不获得 usage tier。 */
export const TagIndexDeprecatedTagRecordSchema = z.object({
    tagId: PositiveIdSchema,
    canonicalName: CanonicalTagNameSchema,
    category: DanbooruTagCategorySchema,
    postCount: z.number().int().min(DANBOORU_MIN_POST_COUNT).safe(),
    isDeprecated: z.literal(true),
    providerCompatibility: z.literal("generic-novelai"),
    sourceUpdatedAt: IsoTimestampSchema,
}).strict();
export type TagIndexDeprecatedTagRecord = z.infer<typeof TagIndexDeprecatedTagRecordSchema>;

/** active Alias 的官方方向固定为 antecedent -> consequent。 */
export const TagIndexAliasRecordSchema = z.object({
    relationId: PositiveIdSchema,
    antecedentName: CanonicalTagNameSchema,
    consequentName: CanonicalTagNameSchema,
    sourceUpdatedAt: IsoTimestampSchema,
}).strict().refine((record) => record.antecedentName !== record.consequentName, {
    message: "Alias 两端不能相同",
});
export type TagIndexAliasRecord = z.infer<typeof TagIndexAliasRecordSchema>;

/** active Implication 的官方方向固定为 antecedent -> consequent。 */
export const TagIndexImplicationRecordSchema = z.object({
    relationId: PositiveIdSchema,
    antecedentName: CanonicalTagNameSchema,
    consequentName: CanonicalTagNameSchema,
    sourceUpdatedAt: IsoTimestampSchema,
}).strict().refine((record) => record.antecedentName !== record.consequentName, {
    message: "Implication 两端不能相同",
});
export type TagIndexImplicationRecord = z.infer<typeof TagIndexImplicationRecordSchema>;

/** 关系闭包中的低频端点；不能作为普通建议候选。 */
export const TagIndexAuxiliaryEndpointSchema = z.object({
    canonicalName: CanonicalTagNameSchema,
    relationKinds: z.array(z.enum(["alias_antecedent", "implication_antecedent", "implication_consequent"]))
        .min(1).max(3),
}).strict();
export type TagIndexAuxiliaryEndpoint = z.infer<typeof TagIndexAuxiliaryEndpointSchema>;

export const TAG_INDEX_NORMALIZED_SNAPSHOT_SCHEMA_VERSION = "nbook.tag-index-normalized/v1" as const;

/** SourceClient facts 经阈值、关系闭包和 tier 分层后的 deterministic builder 输入。 */
export const TagIndexNormalizedSnapshotSchema = z.object({
    schemaVersion: z.literal(TAG_INDEX_NORMALIZED_SNAPSHOT_SCHEMA_VERSION),
    normalizerVersion: StableVersionSchema,
    sourceClientVersion: StableVersionSchema,
    capabilityVersion: StableVersionSchema,
    minPostCount: z.literal(DANBOORU_MIN_POST_COUNT),
    mainTags: z.array(TagIndexTagRecordSchema),
    deprecatedTags: z.array(TagIndexDeprecatedTagRecordSchema),
    aliases: z.array(TagIndexAliasRecordSchema),
    implications: z.array(TagIndexImplicationRecordSchema),
    auxiliaryEndpoints: z.array(TagIndexAuxiliaryEndpointSchema),
    counts: z.object({
        sourceTagCount: SafeCountSchema,
        sourceAliasCount: SafeCountSchema,
        sourceImplicationCount: SafeCountSchema,
        mainTagCount: SafeCountSchema,
        deprecatedTagCount: SafeCountSchema,
        aliasCount: SafeCountSchema,
        implicationCount: SafeCountSchema,
        auxiliaryEndpointCount: SafeCountSchema,
        filteredAliasCount: SafeCountSchema,
        filteredImplicationCount: SafeCountSchema,
        duplicateCount: z.literal(0),
        conflictCount: z.literal(0),
        rejectedCount: z.literal(0),
    }).strict(),
    normalizedHash: TextToImageContractHashSchema,
    indexVersion: z.string().regex(/^db3k_[a-f0-9]{20}$/u),
}).strict().superRefine((snapshot, context) => {
    if (snapshot.mainTags.length !== snapshot.counts.mainTagCount
        || snapshot.deprecatedTags.length !== snapshot.counts.deprecatedTagCount
        || snapshot.aliases.length !== snapshot.counts.aliasCount
        || snapshot.implications.length !== snapshot.counts.implicationCount
        || snapshot.auxiliaryEndpoints.length !== snapshot.counts.auxiliaryEndpointCount) {
        context.addIssue({code: "custom", path: ["counts"], message: "normalized counts 必须与记录数组一致"});
    }
    const tagIds = [...snapshot.mainTags, ...snapshot.deprecatedTags].map((record) => record.tagId);
    const tagNames = [...snapshot.mainTags, ...snapshot.deprecatedTags].map((record) => record.canonicalName);
    if (new Set(tagIds).size !== tagIds.length || new Set(tagNames).size !== tagNames.length) {
        context.addIssue({code: "custom", path: ["mainTags"], message: "normalized canonical identity 必须唯一"});
    }
});
export type TagIndexNormalizedSnapshot = z.infer<typeof TagIndexNormalizedSnapshotSchema>;

export const TagIndexSourceResourceSchema = z.enum(["tags", "aliases", "implications"]);
export const TagIndexSourcePassSchema = z.enum(["source", "reconciliation"]);

/** 一个已完整持久化、可用于断点恢复的官方 API page 证据。 */
export const TagIndexPageProvenanceSchema = z.object({
    resource: TagIndexSourceResourceSchema,
    pass: TagIndexSourcePassSchema,
    pageIdentity: StableIdentitySchema,
    cursorStart: SafeCountSchema,
    cursorEnd: SafeCountSchema,
    watermark: PositiveIdSchema,
    recordCount: z.number().int().min(1).max(1000),
    byteLength: z.number().int().positive().max(16 * 1024 * 1024),
    contentType: z.literal("application/json"),
    hash: TextToImageContractHashSchema,
}).strict().superRefine((page, context) => {
    if (page.cursorEnd <= page.cursorStart || page.cursorEnd > page.watermark) {
        context.addIssue({code: "custom", path: ["cursorEnd"], message: "page cursor 必须单调且不超过 watermark"});
    }
});
export type TagIndexPageProvenance = z.infer<typeof TagIndexPageProvenanceSchema>;

/** builder 的严格输入；只包含已完成两轮一致性校验的 source facts。 */
export const TagIndexSourceTagSchema = z.object({
    id: PositiveIdSchema,
    name: CanonicalTagNameSchema,
    categoryId: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(4), z.literal(5)]),
    postCount: z.number().int().min(DANBOORU_MIN_POST_COUNT).safe(),
    isDeprecated: z.boolean(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
}).strict();
export type TagIndexSourceTag = z.infer<typeof TagIndexSourceTagSchema>;

export const TagIndexSourceRelationshipSchema = z.object({
    id: PositiveIdSchema,
    antecedentName: CanonicalTagNameSchema,
    consequentName: CanonicalTagNameSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
}).strict();
export type TagIndexSourceRelationship = z.infer<typeof TagIndexSourceRelationshipSchema>;

/** 一个 create-only source page cache；records 已由 SourceClient 严格投影。 */
export const TagIndexSourcePageCacheSchema = z.discriminatedUnion("resource", [
    z.object({
        schemaVersion: z.literal("nbook.tag-index-source-page/v1"),
        operationId: StableIdentitySchema,
        resource: z.literal("tags"),
        pass: TagIndexSourcePassSchema,
        provenance: TagIndexPageProvenanceSchema,
        records: z.array(TagIndexSourceTagSchema).min(1).max(1000),
    }).strict(),
    z.object({
        schemaVersion: z.literal("nbook.tag-index-source-page/v1"),
        operationId: StableIdentitySchema,
        resource: z.enum(["aliases", "implications"]),
        pass: TagIndexSourcePassSchema,
        provenance: TagIndexPageProvenanceSchema,
        records: z.array(TagIndexSourceRelationshipSchema).min(1).max(1000),
    }).strict(),
]).superRefine((page, context) => {
    if (page.resource !== page.provenance.resource || page.pass !== page.provenance.pass
        || page.records.length !== page.provenance.recordCount) {
        context.addIssue({code: "custom", path: ["provenance"], message: "page cache 必须与 provenance 一致"});
    }
});
export type TagIndexSourcePageCache = z.infer<typeof TagIndexSourcePageCacheSchema>;

export const TagIndexSourceSnapshotSchema = z.object({
    schemaVersion: z.literal(TAG_INDEX_SOURCE_SNAPSHOT_SCHEMA_VERSION),
    sourceKind: z.literal(TAG_INDEX_SOURCE_KIND),
    sourceEndpoint: z.literal(TAG_INDEX_SOURCE_ENDPOINT),
    minPostCount: z.literal(DANBOORU_MIN_POST_COUNT),
    sourceClientVersion: StableVersionSchema,
    /** source client 显式声明提供哪些资源；未声明资源必须零记录、零 page。 */
    providedResources: z.array(TagIndexSourceResourceSchema).min(1).max(3),
    fetchedAt: IsoTimestampSchema,
    pages: z.array(TagIndexPageProvenanceSchema).min(2),
    tags: z.array(TagIndexSourceTagSchema),
    aliases: z.array(TagIndexSourceRelationshipSchema),
    implications: z.array(TagIndexSourceRelationshipSchema),
    sourceHash: TextToImageContractHashSchema,
    reconciliationHash: TextToImageContractHashSchema,
}).strict().superRefine((snapshot, context) => {
    if (snapshot.sourceHash !== snapshot.reconciliationHash) {
        context.addIssue({code: "custom", path: ["reconciliationHash"], message: "source snapshot 必须完成 reconciliation"});
    }
    if (new Set(snapshot.providedResources).size !== snapshot.providedResources.length
        || !snapshot.providedResources.includes("tags")) {
        context.addIssue({code: "custom", path: ["providedResources"], message: "providedResources 必须去重且至少包含 tags"});
    }
    for (const resource of TagIndexSourceResourceSchema.options) {
        if (snapshot.providedResources.includes(resource)) continue;
        const records = resource === "tags" ? snapshot.tags : resource === "aliases" ? snapshot.aliases : snapshot.implications;
        if (records.length > 0 || snapshot.pages.some((page) => page.resource === resource)) {
            context.addIssue({code: "custom", path: [resource], message: "未声明的资源不能携带记录或 page 证据"});
        }
    }
});
export type TagIndexSourceSnapshot = z.infer<typeof TagIndexSourceSnapshotSchema>;

const TagIndexResourceManifestSchema = z.object({
    watermark: PositiveIdSchema,
    pageCount: z.number().int().positive().safe(),
    firstId: PositiveIdSchema,
    lastId: PositiveIdSchema,
    sourceRecordCount: SafeCountSchema,
    reconciliationRecordCount: SafeCountSchema,
    sourceHash: TextToImageContractHashSchema,
    reconciliationHash: TextToImageContractHashSchema,
    consistency: z.literal("reconciled"),
}).strict().superRefine((resource, context) => {
    if (resource.firstId > resource.lastId || resource.lastId > resource.watermark) {
        context.addIssue({code: "custom", path: ["lastId"], message: "source ID 边界非法"});
    }
    if (resource.sourceRecordCount !== resource.reconciliationRecordCount
        || resource.sourceHash !== resource.reconciliationHash) {
        context.addIssue({code: "custom", path: ["reconciliationHash"], message: "resource reconciliation 未闭合"});
    }
});

export const TagIndexArtifactKindSchema = z.enum([
    "tags_core",
    "tags_high",
    "tags_common",
    "tags_tail",
    "aliases",
    "implications",
    "sqlite",
    "build_report",
]);

const TagIndexArtifactSchema = z.object({
    kind: TagIndexArtifactKindSchema,
    relativePath: z.enum([
        "tags.core.json",
        "tags.high.json",
        "tags.common.json",
        "tags.tail.json",
        "aliases.json",
        "implications.json",
        "tags.sqlite",
        "build-report.json",
    ]),
    recordCount: SafeCountSchema,
    byteLength: SafeCountSchema,
    hash: TextToImageContractHashSchema,
}).strict();

/** SQLite 与固定探针在 ready 前必须全部闭合。 */
export const TagIndexBuildValidationSchema = z.object({
    sqliteIntegrity: z.literal("ok"),
    foreignKeyViolationCount: z.literal(0),
    ftsRowCount: SafeCountSchema,
    exactProbeCount: SafeCountSchema,
    aliasProbeCount: SafeCountSchema,
    searchProbeCount: SafeCountSchema,
}).strict();
export type TagIndexBuildValidation = z.infer<typeof TagIndexBuildValidationSchema>;

/** 不含自引用 hash 的确定性构建报告；其 bytes/hash 由 source manifest 记录。 */
export const TagIndexBuildReportSchema = z.object({
    schemaVersion: z.literal(TAG_INDEX_BUILD_REPORT_SCHEMA_VERSION),
    indexVersion: StableVersionSchema,
    builderVersion: StableVersionSchema,
    normalizerVersion: StableVersionSchema,
    sourceClientVersion: StableVersionSchema,
    capabilityVersion: StableVersionSchema,
    normalizedHash: TextToImageContractHashSchema,
    builtAt: IsoTimestampSchema,
    counts: z.object({
        mainTagCount: SafeCountSchema,
        deprecatedTagCount: SafeCountSchema,
        auxiliaryEndpointCount: SafeCountSchema,
        aliasCount: SafeCountSchema,
        implicationCount: SafeCountSchema,
    }).strict(),
    validation: TagIndexBuildValidationSchema,
    probes: z.object({
        exactCanonicalNames: z.array(CanonicalTagNameSchema).max(3),
        aliasAntecedentNames: z.array(CanonicalTagNameSchema).max(3),
        searchCanonicalNames: z.array(CanonicalTagNameSchema).max(3),
    }).strict(),
    state: z.literal("ready"),
}).strict().superRefine((report, context) => {
    if (report.validation.ftsRowCount !== report.counts.mainTagCount
        || report.validation.exactProbeCount !== report.probes.exactCanonicalNames.length
        || report.validation.aliasProbeCount !== report.probes.aliasAntecedentNames.length
        || report.validation.searchProbeCount !== report.probes.searchCanonicalNames.length) {
        context.addIssue({code: "custom", path: ["validation"], message: "build report probe/count 必须闭合"});
    }
});
export type TagIndexBuildReport = z.infer<typeof TagIndexBuildReportSchema>;

/** active 候选版本的完整来源、工件与校验真相。 */
export const TagIndexManifestSchema = z.object({
    schemaVersion: z.literal(TAG_INDEX_MANIFEST_SCHEMA_VERSION),
    indexVersion: StableVersionSchema,
    builderVersion: StableVersionSchema,
    normalizerVersion: StableVersionSchema,
    sourceClientVersion: StableVersionSchema,
    capabilityVersion: StableVersionSchema,
    normalizedHash: TextToImageContractHashSchema,
    sourceKind: z.literal(TAG_INDEX_SOURCE_KIND),
    sourceEndpoint: z.literal(TAG_INDEX_SOURCE_ENDPOINT),
    apiVersion: z.literal("json-v1"),
    minPostCount: z.literal(DANBOORU_MIN_POST_COUNT),
    /** source client 显式声明的资源集合；未声明资源在 resources 中只允许空占位。 */
    providedResources: z.array(TagIndexSourceResourceSchema).min(1).max(3),
    fetchedAt: IsoTimestampSchema,
    snapshotDate: IsoDateSchema,
    terms: z.object({
        termsUrl: z.literal("https://danbooru.donmai.us/terms_of_service"),
        attributionUrl: z.literal("https://danbooru.donmai.us/"),
        contentHash: TextToImageContractHashSchema,
        userConfirmationVersion: StableVersionSchema,
        retrievalPolicyVersion: StableVersionSchema,
    }).strict(),
    sourceResponse: z.object({
        schemaVersion: z.literal("ttp-tagdata-v1"),
        contentType: z.literal("application/json"),
        compression: z.literal("transport-decoded"),
    }).strict(),
    sourcePages: z.array(TagIndexPageProvenanceSchema).min(2),
    resources: z.object({
        tags: TagIndexResourceManifestSchema,
        aliases: TagIndexResourceManifestSchema,
        implications: TagIndexResourceManifestSchema,
    }).strict(),
    counts: z.object({
        sourceRecordCount: SafeCountSchema,
        normalizedRecordCount: SafeCountSchema,
        indexedProvenanceCount: SafeCountSchema,
        uniqueCanonicalTagCount: SafeCountSchema,
        mainTagCount: SafeCountSchema,
        deprecatedTagCount: SafeCountSchema,
        auxiliaryEndpointCount: SafeCountSchema,
        aliasCount: SafeCountSchema,
        implicationCount: SafeCountSchema,
        duplicateCount: SafeCountSchema,
        conflictCount: SafeCountSchema,
        rejectedCount: SafeCountSchema,
    }).strict(),
    artifacts: z.array(TagIndexArtifactSchema).length(8),
    validation: TagIndexBuildValidationSchema,
    state: z.literal("ready"),
}).strict().superRefine((manifest, context) => {
    const kinds = manifest.artifacts.map((artifact) => artifact.kind);
    if (new Set(kinds).size !== TagIndexArtifactKindSchema.options.length
        || TagIndexArtifactKindSchema.options.some((kind) => !kinds.includes(kind))) {
        context.addIssue({code: "custom", path: ["artifacts"], message: "manifest 必须包含且只包含八种工件"});
    }
    const tierCount = manifest.artifacts
        .filter((artifact) => artifact.kind.startsWith("tags_"))
        .reduce((total, artifact) => total + artifact.recordCount, 0);
    if (tierCount !== manifest.counts.mainTagCount || manifest.validation.ftsRowCount !== manifest.counts.mainTagCount) {
        context.addIssue({code: "custom", path: ["counts", "mainTagCount"], message: "tier/FTS/main Tag 记录数必须一致"});
    }
    const pageIdentities = manifest.sourcePages.map((page) => page.pageIdentity);
    if (new Set(pageIdentities).size !== pageIdentities.length) {
        context.addIssue({code: "custom", path: ["sourcePages"], message: "source page identity 不能重复"});
    }
    if (new Set(manifest.providedResources).size !== manifest.providedResources.length
        || !manifest.providedResources.includes("tags")) {
        context.addIssue({code: "custom", path: ["providedResources"], message: "providedResources 必须去重且至少包含 tags"});
    }
    for (const pass of TagIndexSourcePassSchema.options) {
        for (const resource of TagIndexSourceResourceSchema.options) {
            const provided = manifest.providedResources.includes(resource);
            const hasPages = manifest.sourcePages.some((page) => page.pass === pass && page.resource === resource);
            if (provided && !hasPages) {
                context.addIssue({code: "custom", path: ["sourcePages"], message: "source manifest 缺少完整双轮资源证据"});
            }
            if (!provided && (hasPages || manifest.resources[resource].sourceRecordCount !== 0)) {
                context.addIssue({code: "custom", path: ["sourcePages"], message: "未声明的资源不能携带 source 证据或记录"});
            }
        }
    }
});
export type TagIndexManifest = z.infer<typeof TagIndexManifestSchema>;

/** Workspace Root 唯一 active pointer；不内嵌可编辑索引事实。 */
export const TagIndexActivePointerSchema = z.object({
    schemaVersion: z.literal(TAG_INDEX_CURRENT_SCHEMA_VERSION),
    indexVersion: StableVersionSchema,
    manifestHash: TextToImageContractHashSchema,
    activatedAt: IsoTimestampSchema,
}).strict();
export type TagIndexActivePointer = z.infer<typeof TagIndexActivePointerSchema>;

export const TagIndexOperationStateSchema = z.enum([
    "fetching",
    "source_verified",
    "normalizing",
    "indexing",
    "validating",
    "ready",
    "active",
    "failed",
    "canceled",
]);

export const TagIndexRetrySchema = z.object({
    reason: z.enum(["network_error", "rate_limited", "server_error"]),
    attempt: z.number().int().positive().max(11),
    retryAt: IsoTimestampSchema,
}).strict();
export type TagIndexRetry = z.infer<typeof TagIndexRetrySchema>;

/** 可恢复同步 operation 的有限状态；详细 page 事实由 source page manifest 承担。 */
export const TagIndexOperationSchema = z.object({
    schemaVersion: z.literal(TAG_INDEX_OPERATION_SCHEMA_VERSION),
    operationId: StableIdentitySchema,
    state: TagIndexOperationStateSchema,
    requestedAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    termsConfirmationVersion: StableVersionSchema,
    activeIndexVersionBeforeStart: StableVersionSchema.nullable(),
    activePointerHashBeforeStart: TextToImageContractHashSchema.nullable(),
    candidateIndexVersion: StableVersionSchema.nullable(),
    cancelRequestedAt: IsoTimestampSchema.nullable(),
    retry: TagIndexRetrySchema.nullable(),
    lease: z.object({
        ownerId: StableIdentitySchema,
        fencingVersion: z.number().int().positive().safe(),
        leaseUntil: IsoTimestampSchema,
    }).strict().nullable(),
    source: z.object({
        watermarks: z.object({
            tags: PositiveIdSchema,
            aliases: PositiveIdSchema,
            implications: PositiveIdSchema,
        }).strict().nullable(),
        pass: TagIndexSourcePassSchema,
        resource: TagIndexSourceResourceSchema,
        cursors: z.object({
            source: z.object({tags: SafeCountSchema, aliases: SafeCountSchema, implications: SafeCountSchema}).strict(),
            reconciliation: z.object({tags: SafeCountSchema, aliases: SafeCountSchema, implications: SafeCountSchema}).strict(),
        }).strict(),
        completedResources: z.object({
            source: z.array(TagIndexSourceResourceSchema).max(3),
            reconciliation: z.array(TagIndexSourceResourceSchema).max(3),
        }).strict(),
        verifiedHashes: z.object({
            tags: TextToImageContractHashSchema,
            aliases: TextToImageContractHashSchema,
            implications: TextToImageContractHashSchema,
        }).strict().nullable(),
    }).strict(),
    error: z.object({code: StableIdentitySchema, message: z.string().trim().min(1).max(1000)}).strict().nullable(),
}).strict().superRefine((operation, context) => {
    for (const pass of TagIndexSourcePassSchema.options) {
        const completed = operation.source.completedResources[pass];
        if (new Set(completed).size !== completed.length) {
            context.addIssue({code: "custom", path: ["source", "completedResources", pass], message: "completed resource 不能重复"});
        }
    }
    const sourceCompleteStates = ["source_verified", "normalizing", "indexing", "validating", "ready", "active"];
    if (sourceCompleteStates.includes(operation.state) && !operation.source.verifiedHashes) {
        context.addIssue({code: "custom", path: ["source", "verifiedHashes"], message: "source_verified 及后续阶段必须冻结 reconciliation hashes"});
    }
    const candidateStates = ["indexing", "validating", "ready", "active"];
    if (candidateStates.includes(operation.state) && !operation.candidateIndexVersion) {
        context.addIssue({code: "custom", path: ["candidateIndexVersion"], message: "indexing 及后续阶段必须冻结 candidate indexVersion"});
    }
    if (["active", "failed", "canceled"].includes(operation.state) && operation.lease) {
        context.addIssue({code: "custom", path: ["lease"], message: "terminal operation 不能保留 lease"});
    }
    if (["active", "failed", "canceled"].includes(operation.state) && operation.retry) {
        context.addIssue({code: "custom", path: ["retry"], message: "terminal operation 不能保留 retry"});
    }
});
export type TagIndexOperation = z.infer<typeof TagIndexOperationSchema>;
export type TagIndexOperationLease = NonNullable<TagIndexOperation["lease"]>;

const TagIndexTierSummarySchema = z.object({
    count: SafeCountSchema,
    hash: TextToImageContractHashSchema,
}).strict();

export const TagIndexActiveSummarySchema = z.object({
    indexVersion: StableVersionSchema,
    manifestHash: TextToImageContractHashSchema,
    activatedAt: IsoTimestampSchema,
    fetchedAt: IsoTimestampSchema,
    snapshotDate: IsoDateSchema,
    watermarks: z.object({
        tags: PositiveIdSchema,
        aliases: PositiveIdSchema,
        implications: PositiveIdSchema,
    }).strict(),
    counts: z.object({
        mainTags: SafeCountSchema,
        deprecatedTags: SafeCountSchema,
        aliases: SafeCountSchema,
        implications: SafeCountSchema,
    }).strict(),
    tiers: z.object({
        core: TagIndexTierSummarySchema,
        high: TagIndexTierSummarySchema,
        common: TagIndexTierSummarySchema,
        tail: TagIndexTierSummarySchema,
    }).strict(),
    validation: TagIndexBuildValidationSchema,
}).strict();
export type TagIndexActiveSummary = z.infer<typeof TagIndexActiveSummarySchema>;

/** 设置页只读状态；索引事实仍只存在于 Workspace Root 服务端工件。 */
export const TagIndexStatusSchema = z.object({
    schemaVersion: z.literal(TAG_INDEX_STATUS_SCHEMA_VERSION),
    source: z.object({
        kind: z.literal(TAG_INDEX_SOURCE_KIND),
        endpoint: z.literal(TAG_INDEX_SOURCE_ENDPOINT),
        minPostCount: z.literal(DANBOORU_MIN_POST_COUNT),
    }).strict(),
    terms: z.object({
        confirmationVersion: z.literal(TAG_INDEX_TERMS_CONFIRMATION_VERSION),
        retrievalPolicyVersion: z.literal(TAG_INDEX_RETRIEVAL_POLICY_VERSION),
        contentHash: TextToImageContractHashSchema,
        termsUrl: z.literal("https://danbooru.donmai.us/terms_of_service"),
        attributionUrl: z.literal("https://danbooru.donmai.us/"),
        statement: z.string().trim().min(1).max(1000),
    }).strict(),
    active: TagIndexActiveSummarySchema.nullable(),
    operation: TagIndexOperationSchema.nullable(),
    progress: z.object({
        pageCount: SafeCountSchema,
        recordCount: SafeCountSchema,
    }).strict().nullable(),
    oldActiveContinuing: z.boolean(),
}).strict().superRefine((status, context) => {
    if ((status.operation === null) !== (status.progress === null)) {
        context.addIssue({code: "custom", path: ["progress"], message: "operation 与 progress 必须同时存在或同时为空"});
    }
    const operationInProgress = status.operation !== null
        && !["active", "failed", "canceled"].includes(status.operation.state);
    if (status.oldActiveContinuing !== Boolean(status.active && operationInProgress)) {
        context.addIssue({code: "custom", path: ["oldActiveContinuing"], message: "旧 active continuing 状态不一致"});
    }
});
export type TagIndexStatus = z.infer<typeof TagIndexStatusSchema>;

/** 同步请求只确认当前固定条款；不接受 URL、阈值或第三方 source。 */
export const TagIndexSyncRequestSchema = z.object({
    confirmed: z.literal(true),
    termsConfirmationVersion: z.literal(TAG_INDEX_TERMS_CONFIRMATION_VERSION),
    termsContentHash: TextToImageContractHashSchema,
}).strict();
export type TagIndexSyncRequest = z.infer<typeof TagIndexSyncRequestSchema>;

export const TagIndexSearchRequestSchema = z.object({
    query: z.string().trim().min(1).max(240),
    category: DanbooruTagCategorySchema.optional(),
    limit: z.coerce.number().int().min(1).max(30).default(20),
}).strict();
export type TagIndexSearchRequest = z.infer<typeof TagIndexSearchRequestSchema>;

const TagIndexSearchCandidateSchema = z.object({
    canonical: z.object({tagId: PositiveIdSchema, canonicalName: CanonicalTagNameSchema}).strict(),
    category: DanbooruTagCategorySchema,
    postCount: z.number().int().min(DANBOORU_MIN_POST_COUNT).safe(),
    usageTier: TagUsageTierSchema,
    providerCompatibility: z.literal("generic-novelai"),
    matchClass: z.enum(["exact", "alias", "prefix", "token", "fts"]),
    normalizedMatchScore: z.number().min(0).max(1),
}).strict();

export const TagIndexSearchResponseSchema = z.object({
    candidates: z.array(TagIndexSearchCandidateSchema).max(30),
    evidence: z.object({
        indexVersion: StableVersionSchema,
        manifestHash: TextToImageContractHashSchema,
        queriedTiers: z.array(TagUsageTierSchema).max(4),
        candidateSetHash: TextToImageContractHashSchema,
    }).strict(),
}).strict();
export type TagIndexSearchResponse = z.infer<typeof TagIndexSearchResponseSchema>;
