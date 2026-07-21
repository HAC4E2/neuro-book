import {describe, expect, it} from "vitest";
import {TagIndexSourceSnapshotSchema, type TagIndexSourceSnapshot} from "nbook/shared/text-to-image-tag-index";
import {normalizeTagIndexSnapshot} from "nbook/server/text-to-image/tag-index/tag-index-normalizer";

const HASH_A = `sha256:${"a".repeat(64)}`;

/** 构造已完成两轮 reconciliation 的最小 source snapshot。 */
function sourceSnapshot(overrides: Partial<Pick<TagIndexSourceSnapshot, "tags" | "aliases" | "implications">> = {}): TagIndexSourceSnapshot {
    const resourcePage = (
        resource: "tags" | "aliases" | "implications",
        pass: "source" | "reconciliation",
        watermark: number,
        recordCount: number,
    ) => ({
        resource,
        pass,
        pageIdentity: `${resource}.${pass}.0.${watermark}`,
        cursorStart: 0,
        cursorEnd: watermark,
        watermark,
        recordCount,
        byteLength: 100,
        contentType: "application/json" as const,
        hash: HASH_A,
    });
    return TagIndexSourceSnapshotSchema.parse({
        schemaVersion: "nbook.tag-index-source-snapshot/v1",
        sourceKind: "danbooru-api",
        sourceEndpoint: "https://danbooru.donmai.us",
        minPostCount: 3000,
        sourceClientVersion: "danbooru-source-v1",
        fetchedAt: "2026-07-20T00:00:00.000Z",
        pages: [
            resourcePage("tags", "source", 6, 6),
            resourcePage("aliases", "source", 3, 3),
            resourcePage("implications", "source", 3, 3),
            resourcePage("tags", "reconciliation", 6, 6),
            resourcePage("aliases", "reconciliation", 3, 3),
            resourcePage("implications", "reconciliation", 3, 3),
        ],
        tags: overrides.tags ?? [
            tag(1, "tail_low", 3000),
            tag(2, "tail_high", 9999),
            tag(3, "common_tag", 10000),
            tag(4, "high_tag", 30000),
            tag(5, "core_tag", 100000),
            tag(6, "deprecated_tag", 5000, true),
        ],
        aliases: overrides.aliases ?? [
            relation(1, "legacy_core", "core_tag"),
            relation(2, "irrelevant_alias", "below_threshold"),
            relation(3, "deprecated_tag", "tail_low"),
        ],
        implications: overrides.implications ?? [
            relation(1, "core_tag", "low_weather"),
            relation(2, "tail_low", "core_tag"),
            relation(3, "unrelated_low", "another_low"),
        ],
        sourceHash: HASH_A,
        reconciliationHash: HASH_A,
    });
}

/** 官方 3K+ Tag source row。 */
function tag(id: number, name: string, postCount: number, isDeprecated = false): TagIndexSourceSnapshot["tags"][number] {
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

/** 官方 active relationship source row。 */
function relation(id: number, antecedentName: string, consequentName: string): TagIndexSourceSnapshot["aliases"][number] {
    return {
        id,
        antecedentName,
        consequentName,
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z",
    };
}

describe("TagIndexNormalizer", () => {
    it("partitions every active 3K+ Tag into one deterministic tier", () => {
        const normalized = normalizeTagIndexSnapshot({snapshot: sourceSnapshot(), capabilityVersion: "nai-cap-v1"});

        expect(normalized.mainTags.map((record) => [record.canonicalName, record.usageTier])).toEqual([
            ["core_tag", "core"],
            ["high_tag", "high"],
            ["common_tag", "common"],
            ["tail_high", "tail"],
            ["tail_low", "tail"],
        ]);
        expect(normalized.mainTags.every((record) => record.providerCompatibility === "generic-novelai")).toBe(true);
        expect(normalized.capabilityVersion).toBe("nai-cap-v1");
        expect(normalized.deprecatedTags.map((record) => record.canonicalName)).toEqual(["deprecated_tag"]);
        expect(normalized.counts.mainTagCount).toBe(5);
    });

    it("closes aliases and implications around the main set without promoting low-frequency endpoints", () => {
        const normalized = normalizeTagIndexSnapshot({snapshot: sourceSnapshot(), capabilityVersion: "nai-cap-v1"});

        expect(normalized.aliases.map((record) => [record.antecedentName, record.consequentName])).toEqual([
            ["deprecated_tag", "tail_low"],
            ["legacy_core", "core_tag"],
        ]);
        expect(normalized.implications.map((record) => [record.antecedentName, record.consequentName])).toEqual([
            ["core_tag", "low_weather"],
            ["tail_low", "core_tag"],
        ]);
        expect(normalized.auxiliaryEndpoints).toEqual([
            {canonicalName: "legacy_core", relationKinds: ["alias_antecedent"]},
            {canonicalName: "low_weather", relationKinds: ["implication_consequent"]},
        ]);
        expect(normalized.aliases.some((record) => record.antecedentName === "irrelevant_alias")).toBe(false);
        expect(normalized.implications.some((record) => record.antecedentName === "unrelated_low")).toBe(false);
    });

    it("is invariant to source array order", () => {
        const input = sourceSnapshot();
        const first = normalizeTagIndexSnapshot({snapshot: input, capabilityVersion: "nai-cap-v1"});
        const second = normalizeTagIndexSnapshot({
            snapshot: sourceSnapshot({
                tags: [...input.tags].reverse(),
                aliases: [...input.aliases].reverse(),
                implications: [...input.implications].reverse(),
            }),
            capabilityVersion: "nai-cap-v1",
        });

        expect(second.normalizedHash).toBe(first.normalizedHash);
        expect(second.indexVersion).toBe(first.indexVersion);
        expect(second.mainTags).toEqual(first.mainTags);
    });

    it("fails closed on duplicate canonical identity, alias ambiguity and alias chains", () => {
        const duplicateName = sourceSnapshot({tags: [tag(1, "same_name", 3000), tag(2, "same_name", 4000)]});
        expect(() => normalizeTagIndexSnapshot({snapshot: duplicateName, capabilityVersion: "nai-cap-v1"}))
            .toThrow(/canonical/u);

        const ambiguousAlias = sourceSnapshot({
            aliases: [relation(1, "old_name", "tail_low"), relation(2, "old_name", "core_tag")],
        });
        expect(() => normalizeTagIndexSnapshot({snapshot: ambiguousAlias, capabilityVersion: "nai-cap-v1"}))
            .toThrow(/Alias/u);

        const aliasChain = sourceSnapshot({
            aliases: [relation(1, "old_name", "tail_low"), relation(2, "tail_low", "core_tag")],
        });
        expect(() => normalizeTagIndexSnapshot({snapshot: aliasChain, capabilityVersion: "nai-cap-v1"}))
            .toThrow(/Alias/u);
    });

    it("changes normalized identity when capability or official facts change", () => {
        const first = normalizeTagIndexSnapshot({snapshot: sourceSnapshot(), capabilityVersion: "nai-cap-v1"});
        const nextCapability = normalizeTagIndexSnapshot({snapshot: sourceSnapshot(), capabilityVersion: "nai-cap-v2"});
        const changedFacts = sourceSnapshot();
        changedFacts.tags[0] = {...changedFacts.tags[0]!, postCount: 3001};
        const nextFacts = normalizeTagIndexSnapshot({snapshot: changedFacts, capabilityVersion: "nai-cap-v1"});

        expect(nextCapability.normalizedHash).not.toBe(first.normalizedHash);
        expect(nextFacts.normalizedHash).not.toBe(first.normalizedHash);
    });
});
