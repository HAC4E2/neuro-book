import {describe, expect, it} from "vitest";
import {
    DANBOORU_MIN_POST_COUNT,
    TAG_INDEX_TERMS_CONFIRMATION_VERSION,
    TagIndexActivePointerSchema,
    TagIndexManifestSchema,
    TagIndexStatusSchema,
    TagIndexSyncRequestSchema,
    TagIndexTagRecordSchema,
    resolveDanbooruCategory,
    resolveTagUsageTier,
} from "nbook/shared/text-to-image-tag-index";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

/** 构造达到 ready 门的最小 manifest fixture。 */
function manifestFixture(): Record<string, object | string | number> {
    const resource = {
        watermark: 30,
        pageCount: 2,
        firstId: 1,
        lastId: 30,
        sourceRecordCount: 3,
        reconciliationRecordCount: 3,
        sourceHash: HASH_A,
        reconciliationHash: HASH_A,
        consistency: "reconciled",
    };
    return {
        schemaVersion: "nbook.tag-index-manifest/v1",
        indexVersion: "db3k-fixture",
        builderVersion: "builder-v1",
        normalizerVersion: "normalizer-v1",
        sourceClientVersion: "danbooru-v1",
        capabilityVersion: "nai-cap-v1",
        normalizedHash: HASH_A,
        sourceKind: "danbooru-api",
        sourceEndpoint: "https://danbooru.donmai.us",
        apiVersion: "json-v1",
        minPostCount: DANBOORU_MIN_POST_COUNT,
        fetchedAt: "2026-07-20T00:00:00.000Z",
        snapshotDate: "2026-07-20",
        terms: {
            termsUrl: "https://danbooru.donmai.us/terms_of_service",
            attributionUrl: "https://danbooru.donmai.us/",
            contentHash: HASH_B,
            userConfirmationVersion: "danbooru-terms-2026-07",
            retrievalPolicyVersion: "nbook-danbooru-retrieval-v1",
        },
        sourceResponse: {
            schemaVersion: "danbooru-json-v1",
            contentType: "application/json",
            compression: "transport-decoded",
        },
        sourcePages: (["source", "reconciliation"] as const).flatMap((pass) => [
            {resource: "tags", pass, pageIdentity: `tags.${pass}`, cursorStart: 0, cursorEnd: 30, watermark: 30, recordCount: 3, byteLength: 100, contentType: "application/json", hash: HASH_A},
            {resource: "aliases", pass, pageIdentity: `aliases.${pass}`, cursorStart: 0, cursorEnd: 30, watermark: 30, recordCount: 3, byteLength: 100, contentType: "application/json", hash: HASH_A},
            {resource: "implications", pass, pageIdentity: `implications.${pass}`, cursorStart: 0, cursorEnd: 30, watermark: 30, recordCount: 3, byteLength: 100, contentType: "application/json", hash: HASH_A},
        ]),
        resources: {tags: resource, aliases: resource, implications: resource},
        counts: {
            sourceRecordCount: 9,
            normalizedRecordCount: 7,
            indexedProvenanceCount: 9,
            uniqueCanonicalTagCount: 3,
            mainTagCount: 2,
            deprecatedTagCount: 1,
            auxiliaryEndpointCount: 1,
            aliasCount: 1,
            implicationCount: 1,
            duplicateCount: 0,
            conflictCount: 0,
            rejectedCount: 0,
        },
        artifacts: [
            {kind: "tags_core", relativePath: "tags.core.json", recordCount: 1, byteLength: 120, hash: HASH_A},
            {kind: "tags_high", relativePath: "tags.high.json", recordCount: 0, byteLength: 3, hash: HASH_A},
            {kind: "tags_common", relativePath: "tags.common.json", recordCount: 0, byteLength: 3, hash: HASH_A},
            {kind: "tags_tail", relativePath: "tags.tail.json", recordCount: 1, byteLength: 120, hash: HASH_A},
            {kind: "aliases", relativePath: "aliases.json", recordCount: 1, byteLength: 80, hash: HASH_A},
            {kind: "implications", relativePath: "implications.json", recordCount: 1, byteLength: 80, hash: HASH_A},
            {kind: "sqlite", relativePath: "tags.sqlite", recordCount: 7, byteLength: 4096, hash: HASH_A},
            {kind: "build_report", relativePath: "build-report.json", recordCount: 1, byteLength: 500, hash: HASH_A},
        ],
        validation: {
            sqliteIntegrity: "ok",
            foreignKeyViolationCount: 0,
            ftsRowCount: 2,
            exactProbeCount: 2,
            aliasProbeCount: 1,
            searchProbeCount: 2,
        },
        state: "ready",
    };
}

describe("text-to-image Tag index contracts", () => {
    it("uses the inclusive 3K threshold and exact four-tier boundaries", () => {
        expect(DANBOORU_MIN_POST_COUNT).toBe(3000);
        expect(resolveTagUsageTier(2999)).toBeNull();
        expect(resolveTagUsageTier(3000)).toBe("tail");
        expect(resolveTagUsageTier(9999)).toBe("tail");
        expect(resolveTagUsageTier(10000)).toBe("common");
        expect(resolveTagUsageTier(29999)).toBe("common");
        expect(resolveTagUsageTier(30000)).toBe("high");
        expect(resolveTagUsageTier(99999)).toBe("high");
        expect(resolveTagUsageTier(100000)).toBe("core");
    });

    it("normalizes only registered official categories", () => {
        expect(resolveDanbooruCategory(0)).toBe("general");
        expect(resolveDanbooruCategory(1)).toBe("artist");
        expect(resolveDanbooruCategory(3)).toBe("copyright");
        expect(resolveDanbooruCategory(4)).toBe("character");
        expect(resolveDanbooruCategory(5)).toBe("meta");
        expect(() => resolveDanbooruCategory(2)).toThrow(/category/u);
        expect(TagIndexTagRecordSchema.parse({
            tagId: 12,
            canonicalName: "what?",
            category: "general",
            postCount: 3000,
            usageTier: "tail",
            isDeprecated: false,
            providerCompatibility: "generic-novelai",
            sourceUpdatedAt: "2026-07-20T00:00:00.000Z",
        }).canonicalName).toBe("what?");
    });

    it("rejects main records whose tier, threshold or deprecated state conflicts", () => {
        const record = {
            tagId: 10,
            canonicalName: "wide_shot",
            category: "general",
            postCount: 3000,
            usageTier: "tail",
            isDeprecated: false,
            providerCompatibility: "generic-novelai",
            sourceUpdatedAt: "2026-07-20T00:00:00.000Z",
        };
        expect(TagIndexTagRecordSchema.parse(record).usageTier).toBe("tail");
        expect(() => TagIndexTagRecordSchema.parse({...record, postCount: 2999})).toThrow();
        expect(() => TagIndexTagRecordSchema.parse({...record, usageTier: "core"})).toThrow();
        expect(() => TagIndexTagRecordSchema.parse({...record, isDeprecated: true})).toThrow();
        expect(() => TagIndexTagRecordSchema.parse({...record, sampler: "k_euler"})).toThrow();
    });

    it("requires every source resource to be reconciled before ready", () => {
        expect(TagIndexManifestSchema.parse(manifestFixture()).state).toBe("ready");
        const drifted = manifestFixture();
        const resources = drifted.resources as Record<string, Record<string, string>>;
        resources.aliases = {...resources.aliases, reconciliationHash: HASH_B};
        expect(() => TagIndexManifestSchema.parse(drifted)).toThrow(/reconciliation/u);
    });

    it("binds active pointer to one immutable ready manifest", () => {
        const pointer = TagIndexActivePointerSchema.parse({
            schemaVersion: "nbook.tag-index-current/v1",
            indexVersion: "db3k-fixture",
            manifestHash: HASH_A,
            activatedAt: "2026-07-20T00:00:00.000Z",
        });
        expect(pointer.indexVersion).toBe("db3k-fixture");
        expect(() => TagIndexActivePointerSchema.parse({...pointer, sourceUrl: "https://example.com"})).toThrow();
    });

    it("accepts only the current fixed terms confirmation and no source override", () => {
        const request = TagIndexSyncRequestSchema.parse({
            confirmed: true,
            termsConfirmationVersion: TAG_INDEX_TERMS_CONFIRMATION_VERSION,
            termsContentHash: HASH_A,
        });
        expect(request.confirmed).toBe(true);
        expect(() => TagIndexSyncRequestSchema.parse({...request, sourceUrl: "https://example.com"})).toThrow();
        expect(() => TagIndexSyncRequestSchema.parse({...request, termsConfirmationVersion: "stale-v1"})).toThrow();
    });

    it("requires status progress and old-active projection to close over operation state", () => {
        const operation = {
            schemaVersion: "nbook.tag-index-operation/v1",
            operationId: "sync-1",
            state: "fetching",
            requestedAt: "2026-07-20T00:00:00.000Z",
            updatedAt: "2026-07-20T00:00:00.000Z",
            termsConfirmationVersion: TAG_INDEX_TERMS_CONFIRMATION_VERSION,
            activeIndexVersionBeforeStart: null,
            activePointerHashBeforeStart: null,
            candidateIndexVersion: null,
            cancelRequestedAt: null,
            retry: null,
            lease: null,
            source: {
                watermarks: null,
                pass: "source",
                resource: "tags",
                cursors: {
                    source: {tags: 0, aliases: 0, implications: 0},
                    reconciliation: {tags: 0, aliases: 0, implications: 0},
                },
                completedResources: {source: [], reconciliation: []},
                verifiedHashes: null,
            },
            error: null,
        };
        const status = {
            schemaVersion: "nbook.tag-index-status/v1",
            source: {kind: "danbooru-api", endpoint: "https://danbooru.donmai.us", minPostCount: 3000},
            terms: {
                confirmationVersion: TAG_INDEX_TERMS_CONFIRMATION_VERSION,
                retrievalPolicyVersion: "nbook-danbooru-retrieval-v1",
                contentHash: HASH_A,
                termsUrl: "https://danbooru.donmai.us/terms_of_service",
                attributionUrl: "https://danbooru.donmai.us/",
                statement: "用户显式确认后才从官方 API 同步。",
            },
            active: null,
            operation,
            progress: {pageCount: 0, recordCount: 0},
            oldActiveContinuing: false,
        };
        expect(TagIndexStatusSchema.parse(status).operation?.state).toBe("fetching");
        expect(() => TagIndexStatusSchema.parse({...status, progress: null})).toThrow();
        expect(() => TagIndexStatusSchema.parse({...status, oldActiveContinuing: true})).toThrow();
    });
});
