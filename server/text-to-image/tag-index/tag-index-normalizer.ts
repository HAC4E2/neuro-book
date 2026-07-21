import {
    DANBOORU_MIN_POST_COUNT,
    TagIndexNormalizedSnapshotSchema,
    TagIndexSourceSnapshotSchema,
    resolveDanbooruCategory,
    resolveTagUsageTier,
    type TagIndexAliasRecord,
    type TagIndexAuxiliaryEndpoint,
    type TagIndexDeprecatedTagRecord,
    type TagIndexImplicationRecord,
    type TagIndexNormalizedSnapshot,
    type TagIndexSourceRelationship,
    type TagIndexTagRecord,
} from "nbook/shared/text-to-image-tag-index";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {TagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";

export const TAG_INDEX_NORMALIZER_VERSION = "nbook-tag-index-normalizer-v1" as const;

/** 把两轮已一致的 official facts 规范为唯一 tier/closure snapshot。 */
export function normalizeTagIndexSnapshot(input: {
    snapshot: Parameters<typeof TagIndexSourceSnapshotSchema.parse>[0];
    capabilityVersion: string;
}): TagIndexNormalizedSnapshot {
    const snapshot = TagIndexSourceSnapshotSchema.parse(input.snapshot);
    const capabilityVersion = parseVersion(input.capabilityVersion, "capabilityVersion");
    assertUniqueCanonicalFacts(snapshot.tags);
    assertUniqueRelationships(snapshot.aliases, "Alias");
    assertUniqueRelationships(snapshot.implications, "Implication");

    const mainTags: TagIndexTagRecord[] = [];
    const deprecatedTags: TagIndexDeprecatedTagRecord[] = [];
    for (const source of snapshot.tags) {
        if (source.isDeprecated) {
            deprecatedTags.push({
                tagId: source.id,
                canonicalName: source.name,
                category: resolveDanbooruCategory(source.categoryId),
                postCount: source.postCount,
                isDeprecated: true,
                providerCompatibility: "generic-novelai",
                sourceUpdatedAt: source.updatedAt,
            });
            continue;
        }
        const usageTier = resolveTagUsageTier(source.postCount);
        if (!usageTier) throw buildError("官方 main Tag 低于 3K 阈值");
        mainTags.push({
            tagId: source.id,
            canonicalName: source.name,
            category: resolveDanbooruCategory(source.categoryId),
            postCount: source.postCount,
            usageTier,
            isDeprecated: false,
            providerCompatibility: "generic-novelai",
            sourceUpdatedAt: source.updatedAt,
        });
    }
    mainTags.sort(compareTagRecords);
    deprecatedTags.sort(compareTagRecords);

    const mainNames = new Set(mainTags.map((record) => record.canonicalName));
    const deprecatedNames = new Set(deprecatedTags.map((record) => record.canonicalName));
    const aliases = normalizeAliases(snapshot.aliases, mainNames);
    const implications = normalizeImplications(snapshot.implications, mainNames);
    const auxiliaryEndpoints = normalizeAuxiliaryEndpoints({aliases, implications, mainNames, deprecatedNames});
    const counts = {
        sourceTagCount: snapshot.tags.length,
        sourceAliasCount: snapshot.aliases.length,
        sourceImplicationCount: snapshot.implications.length,
        mainTagCount: mainTags.length,
        deprecatedTagCount: deprecatedTags.length,
        aliasCount: aliases.length,
        implicationCount: implications.length,
        auxiliaryEndpointCount: auxiliaryEndpoints.length,
        filteredAliasCount: snapshot.aliases.length - aliases.length,
        filteredImplicationCount: snapshot.implications.length - implications.length,
        duplicateCount: 0 as const,
        conflictCount: 0 as const,
        rejectedCount: 0 as const,
    };
    const semanticFacts = {
        schemaVersion: "nbook.tag-index-normalized/v1" as const,
        normalizerVersion: TAG_INDEX_NORMALIZER_VERSION,
        sourceClientVersion: snapshot.sourceClientVersion,
        capabilityVersion,
        minPostCount: DANBOORU_MIN_POST_COUNT,
        mainTags,
        deprecatedTags,
        aliases,
        implications,
        auxiliaryEndpoints,
        counts,
    };
    const normalizedHash = hashTextToImageContract(semanticFacts);
    return TagIndexNormalizedSnapshotSchema.parse({
        ...semanticFacts,
        normalizedHash,
        indexVersion: `db3k_${normalizedHash.slice(7, 27)}`,
    });
}

/** 主 Tag identity 必须在整个 official snapshot 中唯一。 */
function assertUniqueCanonicalFacts(tags: Array<{id: number; name: string}>): void {
    const ids = tags.map((tag) => tag.id);
    const names = tags.map((tag) => tag.name);
    if (new Set(ids).size !== ids.length || new Set(names).size !== names.length) {
        throw buildError("official canonical Tag ID/name 冲突");
    }
}

/** 关系 ID、端点 pair 与 Alias antecedent 必须唯一。 */
function assertUniqueRelationships(relations: TagIndexSourceRelationship[], kind: "Alias" | "Implication"): void {
    const ids = relations.map((relation) => relation.id);
    const pairs = relations.map((relation) => `${relation.antecedentName}\u0000${relation.consequentName}`);
    if (new Set(ids).size !== ids.length || new Set(pairs).size !== pairs.length) {
        throw buildError(`${kind} official relation identity 冲突`);
    }
    if (kind === "Alias") {
        const antecedents = relations.map((relation) => relation.antecedentName);
        if (new Set(antecedents).size !== antecedents.length) {
            throw buildError("Alias antecedent 指向多个 consequent");
        }
    }
}

/** 只保留指向 main canonical 的 Alias，并拒绝 main canonical 再作为 antecedent。 */
function normalizeAliases(relations: TagIndexSourceRelationship[], mainNames: Set<string>): TagIndexAliasRecord[] {
    const aliases = relations.filter((relation) => mainNames.has(relation.consequentName));
    if (aliases.some((relation) => mainNames.has(relation.antecedentName))) {
        throw buildError("Alias chain 或 main canonical antecedent 冲突");
    }
    return aliases.map((relation) => ({
        relationId: relation.id,
        antecedentName: relation.antecedentName,
        consequentName: relation.consequentName,
        sourceUpdatedAt: relation.updatedAt,
    })).sort(compareRelationships);
}

/** 只保留至少一端属于 main set 的 Implication。 */
function normalizeImplications(relations: TagIndexSourceRelationship[], mainNames: Set<string>): TagIndexImplicationRecord[] {
    return relations.filter((relation) => mainNames.has(relation.antecedentName) || mainNames.has(relation.consequentName))
        .map((relation) => ({
            relationId: relation.id,
            antecedentName: relation.antecedentName,
            consequentName: relation.consequentName,
            sourceUpdatedAt: relation.updatedAt,
        }))
        .sort(compareRelationships);
}

/** 汇总闭包中的低频端点；已知 main/deprecated canonical 不重复登记。 */
function normalizeAuxiliaryEndpoints(input: {
    aliases: TagIndexAliasRecord[];
    implications: TagIndexImplicationRecord[];
    mainNames: Set<string>;
    deprecatedNames: Set<string>;
}): TagIndexAuxiliaryEndpoint[] {
    const kinds = new Map<string, Set<TagIndexAuxiliaryEndpoint["relationKinds"][number]>>();
    const add = (name: string, kind: TagIndexAuxiliaryEndpoint["relationKinds"][number]): void => {
        if (input.mainNames.has(name) || input.deprecatedNames.has(name)) return;
        const current = kinds.get(name) ?? new Set<TagIndexAuxiliaryEndpoint["relationKinds"][number]>();
        current.add(kind);
        kinds.set(name, current);
    };
    for (const alias of input.aliases) add(alias.antecedentName, "alias_antecedent");
    for (const implication of input.implications) {
        add(implication.antecedentName, "implication_antecedent");
        add(implication.consequentName, "implication_consequent");
    }
    const kindOrder: TagIndexAuxiliaryEndpoint["relationKinds"][number][] = [
        "alias_antecedent",
        "implication_antecedent",
        "implication_consequent",
    ];
    return [...kinds.entries()].map(([canonicalName, relationKinds]) => ({
        canonicalName,
        relationKinds: [...relationKinds].sort((left, right) => kindOrder.indexOf(left) - kindOrder.indexOf(right)),
    })).sort((left, right) => compareText(left.canonicalName, right.canonicalName));
}

/** 主/deprecated Tag 的稳定频率排序。 */
function compareTagRecords(
    left: {postCount: number; canonicalName: string; tagId: number},
    right: {postCount: number; canonicalName: string; tagId: number},
): number {
    return right.postCount - left.postCount
        || compareText(left.canonicalName, right.canonicalName)
        || left.tagId - right.tagId;
}

/** Alias/Implication 的稳定端点排序。 */
function compareRelationships(
    left: {antecedentName: string; consequentName: string; relationId: number},
    right: {antecedentName: string; consequentName: string; relationId: number},
): number {
    return compareText(left.antecedentName, right.antecedentName)
        || compareText(left.consequentName, right.consequentName)
        || left.relationId - right.relationId;
}

/** 不依赖 locale 的 ASCII 排序。 */
function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** 解析版本字段。 */
function parseVersion(value: string, name: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 160) throw buildError(`${name} 非法`);
    return normalized;
}

/** normalizer 的稳定 fail-closed 错误。 */
function buildError(message: string): TagIndexError {
    return new TagIndexError({code: "TAG_INDEX_BUILD_FAILED", message});
}
