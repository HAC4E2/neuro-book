import {createHash} from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
    TagIndexActivePointerSchema,
    TagIndexManifestSchema,
    TagUsageTierSchema,
    type DanbooruTagCategory,
    type TagIndexActivePointer,
    type TagIndexManifest,
    type TagUsageTier,
} from "nbook/shared/text-to-image-tag-index";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    openTagIndexDatabase,
    type TagIndexDatabase,
    type TagIndexSqliteRow,
} from "nbook/server/text-to-image/tag-index/tag-index-database";
import {TagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";

const ALL_TIERS: TagUsageTier[] = ["core", "high", "common", "tail"];
const TIER_PRIORITY: {[tier in TagUsageTier]: number} = {core: 4, high: 3, common: 2, tail: 1};

export type TagIndexReadEvidence = {
    indexVersion: string;
    manifestHash: string;
    queriedTiers: TagUsageTier[];
    candidateSetHash: string;
};

export type TagIndexMainFact = {
    kind: "main";
    matchedBy: "exact" | "alias";
    /** exact canonical 不存在 aliasName；alias 命中时保存实际 antecedent。 */
    aliasName?: string;
    canonical: {tagId: number; canonicalName: string};
    category: DanbooruTagCategory;
    postCount: number;
    usageTier: TagUsageTier;
    providerCompatibility: "generic-novelai";
    evidence: TagIndexReadEvidence;
};

export type TagIndexDeprecatedFact = {
    kind: "deprecated";
    canonical: {tagId: number; canonicalName: string};
    category: DanbooruTagCategory;
    postCount: number;
    providerCompatibility: "generic-novelai";
    evidence: TagIndexReadEvidence;
};

export type TagIndexExactFact = TagIndexMainFact | TagIndexDeprecatedFact;

export type TagIndexSearchCandidate = {
    canonical: {tagId: number; canonicalName: string};
    category: DanbooruTagCategory;
    postCount: number;
    usageTier: TagUsageTier;
    providerCompatibility: "generic-novelai";
    matchClass: "exact" | "alias" | "token" | "prefix" | "fts";
    normalizedMatchScore: number;
};

export type TagIndexSearchResult = {
    candidates: TagIndexSearchCandidate[];
    evidence: TagIndexReadEvidence;
};

export type TagIndexRelatedFact = {
    relationId: number;
    direction: "incoming" | "outgoing";
    antecedentName: string;
    consequentName: string;
    otherEndpoint: {
        canonicalName: string;
        endpointKind: "main" | "deprecated" | "auxiliary";
    };
};

export type TagIndexRelatedResult = {
    relations: TagIndexRelatedFact[];
    evidence: TagIndexReadEvidence;
};

export type VerifiedTagIndexVersion = {
    versionRoot: string;
    databasePath: string;
    manifest: TagIndexManifest;
    manifestHash: string;
};

type ActiveContext = VerifiedTagIndexVersion & {
    pointer: TagIndexActivePointer;
    pointerHash: string;
};

/** 只通过 `current.json -> source-manifest.json -> tags.sqlite` 读取唯一 active Tag index。 */
export class TagIndexReader {
    private readonly root: string;
    private readonly expected: {indexVersion: string; manifestHash: string} | null;

    constructor(options: {root: string; expected?: {indexVersion: string; manifestHash: string}}) {
        this.root = path.resolve(options.root);
        this.expected = options.expected ? {...options.expected} : null;
    }

    /** 全库 exact canonical/active alias/deprecated 查询；从不受 tier 级联提前停止。 */
    async findExact(sourceText: string): Promise<TagIndexExactFact | null> {
        const canonicalName = normalizeExactName(sourceText);
        if (!canonicalName) return null;
        return this.withActiveDatabase(async (database, context) => {
            const main = queryMainExact(database, canonicalName);
            if (main) return attachExactEvidence(main, context, canonicalName);
            const alias = queryAliasExact(database, canonicalName);
            if (alias) return attachExactEvidence(alias, context, canonicalName);
            const deprecated = queryDeprecatedExact(database, canonicalName);
            if (!deprecated) return null;
            const projection = {...deprecated, queriedTiers: ALL_TIERS};
            return {
                ...deprecated,
                evidence: buildEvidence(context, ALL_TIERS, {query: canonicalName, result: projection}),
            };
        });
    }

    /** exact 优先，随后按 core/high -> common -> tail 级联 prefix/FTS。 */
    async search(input: {query: string; limit: number; category?: DanbooruTagCategory}): Promise<TagIndexSearchResult> {
        const query = normalizeSearchQuery(input.query);
        const limit = parseLimit(input.limit);
        const category = input.category === undefined ? undefined : parseCategory(input.category);
        return this.withActiveDatabase(async (database, context) => {
            const exact = queryMainExact(database, normalizeExactName(query) ?? "")
                ?? queryAliasExact(database, normalizeExactName(query) ?? "");
            if (exact && (!category || exact.category === category)) {
                const candidate = toSearchCandidate(exact, exact.matchedBy, 1);
                return {
                    candidates: [candidate],
                    evidence: buildEvidence(context, ALL_TIERS, {query, category: category ?? null, candidates: [candidate]}),
                };
            }

            const queriedTiers: TagUsageTier[] = [];
            const candidates = new Map<number, TagIndexSearchCandidate>();
            for (const tiers of [["core", "high"], ["common"], ["tail"]] as TagUsageTier[][]) {
                queriedTiers.push(...tiers);
                for (const candidate of queryTierCandidates(database, query, tiers, category, limit * 4)) {
                    const existing = candidates.get(candidate.canonical.tagId);
                    if (!existing || compareSearchCandidates(candidate, existing) < 0) {
                        candidates.set(candidate.canonical.tagId, candidate);
                    }
                }
                if (candidates.size >= limit) break;
            }
            const selected = [...candidates.values()].sort(compareSearchCandidates).slice(0, limit);
            return {
                candidates: selected,
                evidence: buildEvidence(context, queriedTiers, {query, category: category ?? null, candidates: selected}),
            };
        });
    }

    /** 返回官方 Implication facts；auxiliary 端点保留明确 kind，绝不投影成 main candidate。 */
    async findRelated(canonicalNameInput: string, limitInput: number): Promise<TagIndexRelatedResult> {
        const canonicalName = normalizeExactName(canonicalNameInput);
        if (!canonicalName) throw invalidResolution("related Tag name 非法");
        const limit = parseLimit(limitInput);
        return this.withActiveDatabase(async (database, context) => {
            const rows = database.query(`
                SELECT implications.relation_id, implications.antecedent_name, implications.consequent_name,
                       CASE WHEN implications.antecedent_name = ? THEN 'outgoing' ELSE 'incoming' END AS direction,
                       CASE WHEN implications.antecedent_name = ?
                            THEN implications.consequent_name ELSE implications.antecedent_name END AS other_name,
                       endpoints.endpoint_kind AS other_kind
                FROM implications
                JOIN endpoints ON endpoints.canonical_name = CASE WHEN implications.antecedent_name = ?
                    THEN implications.consequent_name ELSE implications.antecedent_name END
                WHERE implications.antecedent_name = ? OR implications.consequent_name = ?
                ORDER BY implications.antecedent_name ASC, implications.consequent_name ASC, implications.relation_id ASC
                LIMIT ?
            `).all(canonicalName, canonicalName, canonicalName, canonicalName, canonicalName, limit);
            const relations = rows.map(readRelatedRow);
            return {
                relations,
                evidence: buildEvidence(context, [], {canonicalName, relations}),
            };
        });
    }

    /** 读取 active pointer 与已验证 manifest；不扫描目录猜测版本。 */
    async readActiveContext(): Promise<{
        pointer: TagIndexActivePointer;
        pointerHash: string;
        manifest: TagIndexManifest;
        manifestHash: string;
    }> {
        const context = await this.loadActiveContext();
        return {
            pointer: context.pointer,
            pointerHash: context.pointerHash,
            manifest: context.manifest,
            manifestHash: context.manifestHash,
        };
    }

    /** 每次查询独立打开只读 SQLite，并在 finally 中关闭。 */
    private async withActiveDatabase<TResult>(
        task: (database: TagIndexDatabase, context: ActiveContext) => Promise<TResult>,
    ): Promise<TResult> {
        const context = await this.loadActiveContext();
        const database = await openTagIndexDatabase(context.databasePath, {readOnly: true});
        try {
            assertDatabaseReady(database, context.manifest);
            return await task(database, context);
        } catch (error) {
            if (error instanceof TagIndexError) throw error;
            throw notReady("active Tag index SQLite 查询失败", error);
        } finally {
            database.close();
        }
    }

    /** current 缺失/损坏/越界/manifest 或 SQLite 漂移一律 NOT_READY。 */
    private async loadActiveContext(): Promise<ActiveContext> {
        try {
            const currentText = await fs.readFile(path.join(this.root, "current.json"), "utf8");
            const currentValue: unknown = JSON.parse(currentText);
            const pointer = TagIndexActivePointerSchema.parse(currentValue);
            const verified = await verifyReadyTagIndexVersion(this.root, pointer, {verifyAllArtifacts: false});
            if (this.expected && (pointer.indexVersion !== this.expected.indexVersion || verified.manifestHash !== this.expected.manifestHash)) {
                throw notReady("active Tag index 与冻结 Planning Input 不一致");
            }
            return {
                ...verified,
                pointer,
                pointerHash: hashTagIndexActivePointer(pointer),
            };
        } catch (error) {
            if (error instanceof TagIndexError && error.code === "TAG_INDEX_NOT_READY") throw error;
            throw notReady("active Tag index 未就绪", error);
        }
    }
}

/** 激活或 reader 使用的 immutable version 验证，不接受调用方路径。 */
export async function verifyReadyTagIndexVersion(
    rootInput: string,
    pointerInput: TagIndexActivePointer,
    options: {verifyAllArtifacts: boolean},
): Promise<VerifiedTagIndexVersion> {
    try {
        const pointer = TagIndexActivePointerSchema.parse(pointerInput);
        const root = path.resolve(rootInput);
        const versionRoot = resolveVersionRoot(root, pointer.indexVersion);
        const manifestBytes = await fs.readFile(path.join(versionRoot, "source-manifest.json"));
        const manifestHash = hashBytes(manifestBytes);
        if (manifestHash !== pointer.manifestHash) throw notReady("source manifest hash 与 current pointer 不一致");
        const manifestValue: unknown = JSON.parse(manifestBytes.toString("utf8"));
        const manifest = TagIndexManifestSchema.parse(manifestValue);
        if (manifest.indexVersion !== pointer.indexVersion || manifest.state !== "ready") {
            throw notReady("source manifest identity/state 不一致");
        }
        const artifacts = options.verifyAllArtifacts
            ? manifest.artifacts
            : manifest.artifacts.filter((artifact) => artifact.kind === "sqlite");
        for (const artifact of artifacts) {
            const bytes = await fs.readFile(path.join(versionRoot, artifact.relativePath));
            if (bytes.byteLength !== artifact.byteLength || hashBytes(bytes) !== artifact.hash) {
                throw notReady(`active 工件 hash 漂移：${artifact.relativePath}`);
            }
        }
        const sqliteArtifact = manifest.artifacts.find((artifact) => artifact.kind === "sqlite");
        if (!sqliteArtifact) throw notReady("source manifest 缺少 SQLite 工件");
        const databasePath = path.join(versionRoot, sqliteArtifact.relativePath);
        const database = await openTagIndexDatabase(databasePath, {readOnly: true});
        try {
            assertDatabaseReady(database, manifest);
        } finally {
            database.close();
        }
        return {versionRoot, databasePath, manifest, manifestHash};
    } catch (error) {
        if (error instanceof TagIndexError && error.code === "TAG_INDEX_NOT_READY") throw error;
        throw notReady("ready Tag index 版本验证失败", error);
    }
}

/** Active pointer 的 expected-hash 使用 canonical contract hash，不依赖 JSON 空白。 */
export function hashTagIndexActivePointer(pointer: TagIndexActivePointer): string {
    return hashTextToImageContract(TagIndexActivePointerSchema.parse(pointer));
}

/** 校验 runtime metadata、SQLite 完整性、外键与 FTS 行数。 */
function assertDatabaseReady(database: TagIndexDatabase, manifest: TagIndexManifest): void {
    const integrity = readText(database.query("PRAGMA integrity_check").get(), "integrity_check");
    if (integrity !== "ok") throw notReady(`SQLite integrity_check 失败：${integrity}`);
    if (database.query("PRAGMA foreign_key_check").all().length !== 0) throw notReady("SQLite foreign_key_check 失败");
    const indexVersion = readText(database.query("SELECT value FROM metadata WHERE key = 'index_version'").get(), "value");
    const normalizedHash = readText(database.query("SELECT value FROM metadata WHERE key = 'normalized_hash'").get(), "value");
    const ftsCount = readNumber(database.query("SELECT COUNT(*) AS count FROM tag_fts").get(), "count");
    if (indexVersion !== manifest.indexVersion || normalizedHash !== manifest.normalizedHash
        || ftsCount !== manifest.validation.ftsRowCount) {
        throw notReady("SQLite metadata/FTS 与 source manifest 不一致");
    }
}

/** 查询 main canonical exact。 */
function queryMainExact(database: TagIndexDatabase, canonicalName: string): Omit<TagIndexMainFact, "evidence"> | null {
    if (!canonicalName) return null;
    const row = database.query(`
        SELECT tag_id, canonical_name, category, post_count, usage_tier, provider_compatibility
        FROM main_tags WHERE canonical_name = ?
    `).get(canonicalName);
    return row ? readMainRow(row, "exact") : null;
}

/** 查询 active Alias exact，并映射到 main consequent。 */
function queryAliasExact(database: TagIndexDatabase, aliasName: string): Omit<TagIndexMainFact, "evidence"> | null {
    if (!aliasName) return null;
    const row = database.query(`
        SELECT main_tags.tag_id, main_tags.canonical_name, main_tags.category, main_tags.post_count,
               main_tags.usage_tier, main_tags.provider_compatibility
        FROM aliases JOIN main_tags ON main_tags.tag_id = aliases.consequent_tag_id
        WHERE aliases.antecedent_name = ?
    `).get(aliasName);
    return row ? {...readMainRow(row, "alias"), aliasName} : null;
}

/** 查询 deprecated canonical evidence。 */
function queryDeprecatedExact(database: TagIndexDatabase, canonicalName: string): Omit<TagIndexDeprecatedFact, "evidence"> | null {
    const row = database.query(`
        SELECT tag_id, canonical_name, category, post_count, provider_compatibility
        FROM deprecated_tags WHERE canonical_name = ?
    `).get(canonicalName);
    if (!row) return null;
    return {
        kind: "deprecated",
        canonical: {tagId: readNumber(row, "tag_id"), canonicalName: readText(row, "canonical_name")},
        category: readCategory(row, "category"),
        postCount: readNumber(row, "post_count"),
        providerCompatibility: readCompatibility(row),
    };
}

/** 查询一个 tier 批次的 prefix + FTS 候选。 */
function queryTierCandidates(
    database: TagIndexDatabase,
    query: string,
    tiers: TagUsageTier[],
    category: DanbooruTagCategory | undefined,
    limit: number,
): TagIndexSearchCandidate[] {
    const placeholders = tiers.map(() => "?").join(", ");
    const categoryClause = category ? " AND main_tags.category = ?" : "";
    const params = category ? [...tiers, category] : tiers;
    const rows = new Map<number, TagIndexSqliteRow>();
    const prefixPattern = `${escapeLike(query)}%`;
    for (const row of database.query(`
        SELECT tag_id, canonical_name, category, post_count, usage_tier, provider_compatibility
        FROM main_tags
        WHERE usage_tier IN (${placeholders})${category ? " AND category = ?" : ""}
          AND canonical_name LIKE ? ESCAPE '\\'
        LIMIT ?
    `).all(...params, prefixPattern, limit)) rows.set(readNumber(row, "tag_id"), row);

    const ftsQuery = buildFtsQuery(query);
    if (ftsQuery) {
        for (const row of database.query(`
            SELECT main_tags.tag_id, main_tags.canonical_name, main_tags.category, main_tags.post_count,
                   main_tags.usage_tier, main_tags.provider_compatibility
            FROM tag_fts JOIN main_tags ON main_tags.tag_id = tag_fts.rowid
            WHERE tag_fts MATCH ? AND main_tags.usage_tier IN (${placeholders})${categoryClause}
            LIMIT ?
        `).all(ftsQuery, ...params, limit)) rows.set(readNumber(row, "tag_id"), row);
    }
    return [...rows.values()].map((row) => {
        const canonicalName = readText(row, "canonical_name");
        const matchClass = canonicalName.startsWith(query)
            ? "prefix" as const
            : canonicalName.split(/[_-]+/u).includes(query) ? "token" as const : "fts" as const;
        const score = matchClass === "prefix" ? 0.95 : matchClass === "token" ? 0.9 : 0.8;
        return toSearchCandidate(readMainRow(row, "exact"), matchClass, score);
    });
}

/** SQLite main row 严格收窄。 */
function readMainRow(row: TagIndexSqliteRow, matchedBy: "exact" | "alias"): Omit<TagIndexMainFact, "evidence"> {
    const usageTier = TagUsageTierSchema.parse(readText(row, "usage_tier"));
    return {
        kind: "main",
        matchedBy,
        canonical: {tagId: readNumber(row, "tag_id"), canonicalName: readText(row, "canonical_name")},
        category: readCategory(row, "category"),
        postCount: readNumber(row, "post_count"),
        usageTier,
        providerCompatibility: readCompatibility(row),
    };
}

/** SQLite implication + endpoint kind 行严格收窄。 */
function readRelatedRow(row: TagIndexSqliteRow): TagIndexRelatedFact {
    const direction = readText(row, "direction");
    const endpointKind = readText(row, "other_kind");
    if (direction !== "incoming" && direction !== "outgoing") throw notReady("SQLite relation direction 非法");
    if (endpointKind !== "main" && endpointKind !== "deprecated" && endpointKind !== "auxiliary") {
        throw notReady("SQLite relation endpoint kind 非法");
    }
    return {
        relationId: readNumber(row, "relation_id"),
        direction,
        antecedentName: readText(row, "antecedent_name"),
        consequentName: readText(row, "consequent_name"),
        otherEndpoint: {
            canonicalName: readText(row, "other_name"),
            endpointKind,
        },
    };
}

/** exact 结果冻结 active manifest 与全库查询 evidence。 */
function attachExactEvidence(
    fact: Omit<TagIndexMainFact, "evidence">,
    context: ActiveContext,
    query: string,
): TagIndexMainFact {
    return {
        ...fact,
        evidence: buildEvidence(context, ALL_TIERS, {query, result: fact}),
    };
}

/** 把 main fact 投影为 search candidate。 */
function toSearchCandidate(
    fact: Omit<TagIndexMainFact, "evidence">,
    matchClass: TagIndexSearchCandidate["matchClass"],
    normalizedMatchScore: number,
): TagIndexSearchCandidate {
    return {
        canonical: fact.canonical,
        category: fact.category,
        postCount: fact.postCount,
        usageTier: fact.usageTier,
        providerCompatibility: fact.providerCompatibility,
        matchClass,
        normalizedMatchScore,
    };
}

/** 匹配质量优先，tier/热度仅作同质量 tie-break。 */
function compareSearchCandidates(left: TagIndexSearchCandidate, right: TagIndexSearchCandidate): number {
    const matchOrder = {exact: 0, alias: 1, prefix: 2, token: 3, fts: 4};
    return matchOrder[left.matchClass] - matchOrder[right.matchClass]
        || right.normalizedMatchScore - left.normalizedMatchScore
        || TIER_PRIORITY[right.usageTier] - TIER_PRIORITY[left.usageTier]
        || right.postCount - left.postCount
        || compareText(left.canonical.canonicalName, right.canonical.canonicalName);
}

/** 构建 query/candidate 的不可变 evidence。 */
function buildEvidence(
    context: ActiveContext,
    queriedTiers: TagUsageTier[],
    candidateFacts: Parameters<typeof hashTextToImageContract>[0],
): TagIndexReadEvidence {
    return {
        indexVersion: context.manifest.indexVersion,
        manifestHash: context.manifestHash,
        queriedTiers: [...queriedTiers],
        candidateSetHash: hashTextToImageContract({
            schemaVersion: "nbook.tag-index-read-evidence/v1",
            indexVersion: context.manifest.indexVersion,
            manifestHash: context.manifestHash,
            queriedTiers,
            candidateFacts,
        }),
    };
}

/** exact 名称规范化；无法成为 official name 时返回 null。 */
function normalizeExactName(value: string): string | null {
    const normalized = value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, "_");
    return /^[\x21-\x2b\x2d-\x7e]{1,170}$/u.test(normalized) ? normalized : null;
}

/** 有界 search 输入规范化。 */
function normalizeSearchQuery(value: string): string {
    const normalized = value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, "_");
    if (!normalized || normalized.length > 240 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        throw invalidResolution("Tag search query 非法");
    }
    return normalized;
}

/** FTS5 只接收经过 ASCII token 化的 prefix 查询。 */
function buildFtsQuery(query: string): string | null {
    const tokens = query.split(/[^a-z0-9]+/u).filter(Boolean).slice(0, 8);
    return tokens.length > 0 ? tokens.map((token) => `"${token}"*`).join(" AND ") : null;
}

/** LIKE pattern 转义。 */
function escapeLike(value: string): string {
    return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

/** 读取 SQLite 文本列。 */
function readText(row: TagIndexSqliteRow | null, column: string): string {
    const value = row?.[column];
    if (typeof value !== "string") throw notReady(`SQLite ${column} 字段类型非法`);
    return value;
}

/** 读取 SQLite 非负安全整数列。 */
function readNumber(row: TagIndexSqliteRow | null, column: string): number {
    const value = row?.[column];
    const numeric = typeof value === "bigint" ? Number(value) : value;
    if (typeof numeric !== "number" || !Number.isSafeInteger(numeric) || numeric < 0) {
        throw notReady(`SQLite ${column} 字段类型非法`);
    }
    return numeric;
}

/** 读取固定 category。 */
function readCategory(row: TagIndexSqliteRow, column: string): DanbooruTagCategory {
    return parseCategory(readText(row, column));
}

/** 解析固定 category。 */
function parseCategory(value: string): DanbooruTagCategory {
    switch (value) {
        case "general": return "general";
        case "artist": return "artist";
        case "copyright": return "copyright";
        case "character": return "character";
        case "meta": return "meta";
        default: throw invalidResolution("Tag category 非法");
    }
}

/** 读取唯一 generic NovelAI compatibility marker。 */
function readCompatibility(row: TagIndexSqliteRow): "generic-novelai" {
    if (readText(row, "provider_compatibility") !== "generic-novelai") {
        throw notReady("SQLite provider compatibility 非法");
    }
    return "generic-novelai";
}

/** 有界结果数量。 */
function parseLimit(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 30) throw invalidResolution("Tag search limit 必须是 1..30");
    return value;
}

/** indexVersion 必须仍位于固定 cache root 内。 */
function resolveVersionRoot(root: string, indexVersion: string): string {
    const resolved = path.resolve(root, indexVersion);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw notReady("Tag indexVersion 路径非法");
    return resolved;
}

/** 精确 bytes SHA-256。 */
function hashBytes(value: Uint8Array): string {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** 不依赖 locale 的 ASCII 排序。 */
function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** active/version/SQLite 失败的稳定出口。 */
function notReady(message: string, cause?: unknown): TagIndexError {
    return new TagIndexError({code: "TAG_INDEX_NOT_READY", message, ...(cause instanceof Error ? {cause} : {})});
}

/** reader 输入失败的稳定 Resolver 出口。 */
function invalidResolution(message: string): TagIndexError {
    return new TagIndexError({code: "TAG_RESOLUTION_INVALID", message});
}
