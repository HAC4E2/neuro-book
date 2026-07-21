import {TagIndexSourceSnapshotSchema, type TagIndexSourceSnapshot} from "nbook/shared/text-to-image-tag-index";

export const TAG_INDEX_TEST_HASH_A = `sha256:${"a".repeat(64)}`;
export const TAG_INDEX_TEST_HASH_B = `sha256:${"b".repeat(64)}`;

/** 构造覆盖四 tier、deprecated 与关系闭包的测试 source snapshot。 */
export function createTagIndexTestSnapshot(): TagIndexSourceSnapshot {
    const pages = (["source", "reconciliation"] as const).flatMap((pass) => [
        sourcePage("tags", pass, 6, 6),
        sourcePage("aliases", pass, 2, 2),
        sourcePage("implications", pass, 2, 2),
    ]);
    return TagIndexSourceSnapshotSchema.parse({
        schemaVersion: "nbook.tag-index-source-snapshot/v1",
        sourceKind: "danbooru-api",
        sourceEndpoint: "https://danbooru.donmai.us",
        minPostCount: 3000,
        sourceClientVersion: "danbooru-source-v1",
        fetchedAt: "2026-07-20T00:00:00.000Z",
        pages,
        tags: [
            sourceTag(1, "tail_tag", 3000),
            sourceTag(2, "common_tag", 10000),
            sourceTag(3, "high_tag", 30000),
            sourceTag(4, "core_tag", 100000),
            sourceTag(5, "second_core", 120000),
            sourceTag(6, "deprecated_tag", 5000, true),
        ],
        aliases: [
            sourceRelation(1, "legacy_core", "core_tag"),
            sourceRelation(2, "retired_tail", "tail_tag"),
        ],
        implications: [
            sourceRelation(1, "core_tag", "low_weather"),
            sourceRelation(2, "tail_tag", "core_tag"),
        ],
        sourceHash: TAG_INDEX_TEST_HASH_A,
        reconciliationHash: TAG_INDEX_TEST_HASH_A,
    });
}

/** 固定 terms/attribution fixture。 */
export function createTagIndexTestTerms() {
    return {
        contentHash: TAG_INDEX_TEST_HASH_B,
        userConfirmationVersion: "terms-confirmation-v1",
        retrievalPolicyVersion: "danbooru-retrieval-v1",
    };
}

/** 一个 source page provenance fixture。 */
function sourcePage(
    resource: "tags" | "aliases" | "implications",
    pass: "source" | "reconciliation",
    watermark: number,
    recordCount: number,
) {
    return {
        resource,
        pass,
        pageIdentity: `${resource}.${pass}.0.${watermark}`,
        cursorStart: 0,
        cursorEnd: watermark,
        watermark,
        recordCount,
        byteLength: 100,
        contentType: "application/json" as const,
        hash: TAG_INDEX_TEST_HASH_A,
    };
}

/** 一个 official Tag fixture。 */
function sourceTag(id: number, name: string, postCount: number, isDeprecated = false): TagIndexSourceSnapshot["tags"][number] {
    return {
        id,
        name,
        categoryId: 0,
        postCount,
        isDeprecated,
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z",
    };
}

/** 一个 official active relation fixture。 */
function sourceRelation(id: number, antecedentName: string, consequentName: string): TagIndexSourceSnapshot["aliases"][number] {
    return {
        id,
        antecedentName,
        consequentName,
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z",
    };
}
