import {createHash, randomUUID} from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {z} from "zod";
import {
    TagIndexBuildReportSchema,
    TagIndexManifestSchema,
    TagIndexNormalizedSnapshotSchema,
    TagIndexSourcePassSchema,
    TagIndexSourceResourceSchema,
    TagIndexSourceSnapshotSchema,
    type TagIndexBuildReport,
    type TagIndexBuildValidation,
    type TagIndexManifest,
    type TagIndexNormalizedSnapshot,
    type TagIndexPageProvenance,
    type TagIndexSourceSnapshot,
} from "nbook/shared/text-to-image-tag-index";
import {
    canonicalizeTextToImageContract,
    hashTextToImageContract,
    type TextToImageContractValue,
} from "nbook/shared/text-to-image-contract-hash";
import {openTagIndexDatabase, type TagIndexDatabase} from "nbook/server/text-to-image/tag-index/tag-index-database";
import {TagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";
import {normalizeTagIndexSnapshot} from "nbook/server/text-to-image/tag-index/tag-index-normalizer";

export const TAG_INDEX_BUILDER_VERSION = "nbook-tag-index-builder-v1" as const;

const TermsInputSchema = z.object({
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    userConfirmationVersion: z.string().trim().min(1).max(160),
    retrievalPolicyVersion: z.string().trim().min(1).max(160),
}).strict();

type ArtifactKind = TagIndexManifest["artifacts"][number]["kind"];
type ArtifactPath = TagIndexManifest["artifacts"][number]["relativePath"];
type Artifact = TagIndexManifest["artifacts"][number];

export type TagIndexBuildResult = {
    versionRoot: string;
    manifest: TagIndexManifest;
    manifestHash: string;
};

/** 从已 reconciliation 的 source 与唯一 normalized snapshot 构建不可变 Tag index 版本。 */
export async function buildTagIndexVersion(input: {
    root: string;
    snapshot: TagIndexSourceSnapshot;
    normalized: TagIndexNormalizedSnapshot;
    terms: z.input<typeof TermsInputSchema>;
}): Promise<TagIndexBuildResult> {
    const normalized = TagIndexNormalizedSnapshotSchema.parse(input.normalized);
    const root = resolveBuildRoot(input.root);
    const stagingBase = path.join(root, ".staging");
    const stagingRoot = path.join(stagingBase, `${normalized.indexVersion}.${randomUUID()}`);
    const versionRoot = path.join(root, normalized.indexVersion);
    await fs.mkdir(stagingBase, {recursive: true});
    await fs.mkdir(stagingRoot, {recursive: false});

    try {
        const snapshot = TagIndexSourceSnapshotSchema.parse(input.snapshot);
        const terms = TermsInputSchema.parse(input.terms);
        assertSourceCoverage(snapshot);
        assertNormalizedSnapshot(snapshot, normalized);

        const artifacts: Artifact[] = [];
        for (const tier of ["core", "high", "common", "tail"] as const) {
            const records = normalized.mainTags.filter((record) => record.usageTier === tier);
            artifacts.push(await writeJsonArtifact(
                stagingRoot,
                `tags_${tier}`,
                `tags.${tier}.json`,
                records,
                records.length,
            ));
        }
        artifacts.push(await writeJsonArtifact(
            stagingRoot,
            "aliases",
            "aliases.json",
            normalized.aliases,
            normalized.aliases.length,
        ));
        artifacts.push(await writeJsonArtifact(
            stagingRoot,
            "implications",
            "implications.json",
            normalized.implications,
            normalized.implications.length,
        ));

        const databasePath = path.join(stagingRoot, "tags.sqlite");
        const databaseResult = await buildDatabase(databasePath, normalized);
        artifacts.push(await inspectArtifact(databasePath, "sqlite", "tags.sqlite", normalizedRecordCount(normalized)));

        const report = TagIndexBuildReportSchema.parse({
            schemaVersion: "nbook.tag-index-build-report/v1",
            indexVersion: normalized.indexVersion,
            builderVersion: TAG_INDEX_BUILDER_VERSION,
            normalizerVersion: normalized.normalizerVersion,
            sourceClientVersion: normalized.sourceClientVersion,
            capabilityVersion: normalized.capabilityVersion,
            normalizedHash: normalized.normalizedHash,
            builtAt: snapshot.fetchedAt,
            counts: {
                mainTagCount: normalized.mainTags.length,
                deprecatedTagCount: normalized.deprecatedTags.length,
                auxiliaryEndpointCount: normalized.auxiliaryEndpoints.length,
                aliasCount: normalized.aliases.length,
                implicationCount: normalized.implications.length,
            },
            validation: databaseResult.validation,
            probes: databaseResult.probes,
            state: "ready",
        });
        artifacts.push(await writeJsonArtifact(stagingRoot, "build_report", "build-report.json", report, 1));

        const manifest = buildManifest({snapshot, normalized, terms, artifacts, validation: databaseResult.validation});
        const manifestContent = renderCanonicalJson(manifest);
        const manifestHash = hashBytes(manifestContent);
        await writeFsynced(path.join(stagingRoot, "source-manifest.json"), manifestContent);

        if (await pathExists(versionRoot)) {
            await assertExistingVersion(versionRoot, manifest, manifestHash);
            await fs.rm(stagingRoot, {recursive: true, force: true});
            return {versionRoot, manifest, manifestHash};
        }
        try {
            await fs.rename(stagingRoot, versionRoot);
        } catch (error) {
            if (!(await pathExists(versionRoot))) throw error;
            await assertExistingVersion(versionRoot, manifest, manifestHash);
            await fs.rm(stagingRoot, {recursive: true, force: true});
        }
        return {versionRoot, manifest, manifestHash};
    } catch (error) {
        if (await pathExists(stagingRoot)) await writeFailureReport(stagingRoot, normalized.indexVersion, error);
        if (error instanceof TagIndexError) throw error;
        throw buildError(error instanceof Error ? error.message : "Tag index builder 失败", error);
    }
}

/** 创建 schema、写入稳定顺序数据并执行 ready 前验证。 */
async function buildDatabase(databasePath: string, snapshot: TagIndexNormalizedSnapshot): Promise<{
    validation: TagIndexBuildValidation;
    probes: TagIndexBuildReport["probes"];
}> {
    const database = await openTagIndexDatabase(databasePath, {readOnly: false});
    try {
        database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA temp_store = MEMORY;");
        createDatabaseSchema(database);
        insertDatabaseFacts(database, snapshot);
        database.exec("VACUUM;");
        return validateDatabase(database, snapshot);
    } finally {
        database.close();
    }
}

/** 建立无 extension/vec 的结构化事实与 FTS5 查询面。 */
function createDatabaseSchema(database: TagIndexDatabase): void {
    database.exec(`
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        CREATE TABLE endpoints (
            canonical_name TEXT PRIMARY KEY,
            endpoint_kind TEXT NOT NULL CHECK (endpoint_kind IN ('main', 'deprecated', 'auxiliary'))
        ) STRICT;
        CREATE TABLE main_tags (
            tag_id INTEGER PRIMARY KEY,
            canonical_name TEXT NOT NULL UNIQUE REFERENCES endpoints(canonical_name),
            category TEXT NOT NULL CHECK (category IN ('general', 'artist', 'copyright', 'character', 'meta')),
            post_count INTEGER NOT NULL CHECK (post_count >= 3000),
            usage_tier TEXT NOT NULL CHECK (usage_tier IN ('core', 'high', 'common', 'tail')),
            provider_compatibility TEXT NOT NULL CHECK (provider_compatibility = 'generic-novelai'),
            source_updated_at TEXT NOT NULL,
            UNIQUE (tag_id, canonical_name)
        ) STRICT;
        CREATE TABLE deprecated_tags (
            tag_id INTEGER PRIMARY KEY,
            canonical_name TEXT NOT NULL UNIQUE REFERENCES endpoints(canonical_name),
            category TEXT NOT NULL CHECK (category IN ('general', 'artist', 'copyright', 'character', 'meta')),
            post_count INTEGER NOT NULL CHECK (post_count >= 3000),
            provider_compatibility TEXT NOT NULL CHECK (provider_compatibility = 'generic-novelai'),
            source_updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE auxiliary_endpoints (
            canonical_name TEXT PRIMARY KEY REFERENCES endpoints(canonical_name)
        ) STRICT;
        CREATE TABLE auxiliary_endpoint_kinds (
            canonical_name TEXT NOT NULL REFERENCES auxiliary_endpoints(canonical_name),
            relation_kind TEXT NOT NULL CHECK (relation_kind IN ('alias_antecedent', 'implication_antecedent', 'implication_consequent')),
            PRIMARY KEY (canonical_name, relation_kind)
        ) STRICT;
        CREATE TABLE aliases (
            relation_id INTEGER PRIMARY KEY,
            antecedent_name TEXT NOT NULL UNIQUE REFERENCES endpoints(canonical_name),
            consequent_name TEXT NOT NULL REFERENCES endpoints(canonical_name),
            consequent_tag_id INTEGER NOT NULL,
            source_updated_at TEXT NOT NULL,
            FOREIGN KEY (consequent_tag_id, consequent_name) REFERENCES main_tags(tag_id, canonical_name)
        ) STRICT;
        CREATE TABLE implications (
            relation_id INTEGER PRIMARY KEY,
            antecedent_name TEXT NOT NULL REFERENCES endpoints(canonical_name),
            consequent_name TEXT NOT NULL REFERENCES endpoints(canonical_name),
            source_updated_at TEXT NOT NULL,
            UNIQUE (antecedent_name, consequent_name)
        ) STRICT;
        CREATE VIRTUAL TABLE tag_fts USING fts5(canonical_name, content='main_tags', content_rowid='tag_id');
    `);
}

/** 在单事务中按 canonical 顺序写入全部事实。 */
function insertDatabaseFacts(database: TagIndexDatabase, snapshot: TagIndexNormalizedSnapshot): void {
    const endpoint = database.query("INSERT INTO endpoints(canonical_name, endpoint_kind) VALUES (?, ?)");
    const main = database.query(`
        INSERT INTO main_tags(tag_id, canonical_name, category, post_count, usage_tier, provider_compatibility, source_updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const deprecated = database.query(`
        INSERT INTO deprecated_tags(tag_id, canonical_name, category, post_count, provider_compatibility, source_updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    const auxiliary = database.query("INSERT INTO auxiliary_endpoints(canonical_name) VALUES (?)");
    const auxiliaryKind = database.query("INSERT INTO auxiliary_endpoint_kinds(canonical_name, relation_kind) VALUES (?, ?)");
    const alias = database.query(`
        INSERT INTO aliases(relation_id, antecedent_name, consequent_name, consequent_tag_id, source_updated_at)
        VALUES (?, ?, ?, ?, ?)
    `);
    const implication = database.query(`
        INSERT INTO implications(relation_id, antecedent_name, consequent_name, source_updated_at)
        VALUES (?, ?, ?, ?)
    `);
    const metadata = database.query("INSERT INTO metadata(key, value) VALUES (?, ?)");
    const mainByName = new Map(snapshot.mainTags.map((record) => [record.canonicalName, record]));
    const endpointNames = new Set([
        ...snapshot.mainTags.map((record) => record.canonicalName),
        ...snapshot.deprecatedTags.map((record) => record.canonicalName),
        ...snapshot.auxiliaryEndpoints.map((record) => record.canonicalName),
    ]);
    for (const relation of [...snapshot.aliases, ...snapshot.implications]) {
        if (!endpointNames.has(relation.antecedentName) || !endpointNames.has(relation.consequentName)) {
            throw buildError("Alias/Implication endpoint closure 不完整");
        }
    }

    database.exec("BEGIN IMMEDIATE;");
    try {
        for (const record of snapshot.mainTags) endpoint.run(record.canonicalName, "main");
        for (const record of snapshot.deprecatedTags) endpoint.run(record.canonicalName, "deprecated");
        for (const record of snapshot.auxiliaryEndpoints) endpoint.run(record.canonicalName, "auxiliary");
        for (const record of snapshot.mainTags) {
            main.run(
                record.tagId,
                record.canonicalName,
                record.category,
                record.postCount,
                record.usageTier,
                record.providerCompatibility,
                record.sourceUpdatedAt,
            );
        }
        for (const record of snapshot.deprecatedTags) {
            deprecated.run(
                record.tagId,
                record.canonicalName,
                record.category,
                record.postCount,
                record.providerCompatibility,
                record.sourceUpdatedAt,
            );
        }
        for (const record of snapshot.auxiliaryEndpoints) {
            auxiliary.run(record.canonicalName);
            for (const relationKind of record.relationKinds) auxiliaryKind.run(record.canonicalName, relationKind);
        }
        for (const record of snapshot.aliases) {
            const consequent = mainByName.get(record.consequentName);
            if (!consequent) throw buildError("Alias consequent 不是 main canonical");
            alias.run(record.relationId, record.antecedentName, record.consequentName, consequent.tagId, record.sourceUpdatedAt);
        }
        for (const record of snapshot.implications) {
            implication.run(record.relationId, record.antecedentName, record.consequentName, record.sourceUpdatedAt);
        }
        for (const [key, value] of Object.entries({
            schema_version: "nbook-tag-index-sqlite-v1",
            index_version: snapshot.indexVersion,
            normalized_hash: snapshot.normalizedHash,
            builder_version: TAG_INDEX_BUILDER_VERSION,
            normalizer_version: snapshot.normalizerVersion,
            source_client_version: snapshot.sourceClientVersion,
            capability_version: snapshot.capabilityVersion,
            main_tag_count: String(snapshot.mainTags.length),
        })) metadata.run(key, value);
        database.exec("INSERT INTO tag_fts(rowid, canonical_name) SELECT tag_id, canonical_name FROM main_tags ORDER BY tag_id;");
        database.exec("COMMIT;");
    } catch (error) {
        try {
            database.exec("ROLLBACK;");
        } catch {
            // 原错误提供更准确的失败出口。
        }
        throw error;
    }
}

/** 执行完整性、外键、行数、metadata 与固定 exact/alias/FTS 探针。 */
function validateDatabase(database: TagIndexDatabase, snapshot: TagIndexNormalizedSnapshot): {
    validation: TagIndexBuildValidation;
    probes: TagIndexBuildReport["probes"];
} {
    const integrity = requiredText(database.query("PRAGMA integrity_check").get(), "integrity_check");
    if (integrity !== "ok") throw buildError(`SQLite integrity_check 失败：${integrity}`);
    const foreignKeyViolations = database.query("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length !== 0) throw buildError("SQLite foreign_key_check 失败");
    const ftsRowCount = requiredCount(database.query("SELECT COUNT(*) AS count FROM tag_fts").get());
    if (ftsRowCount !== snapshot.mainTags.length) throw buildError("SQLite FTS/main Tag count 不一致");
    const metadataHash = requiredText(
        database.query("SELECT value FROM metadata WHERE key = 'normalized_hash'").get(),
        "value",
    );
    if (metadataHash !== snapshot.normalizedHash) throw buildError("SQLite metadata normalized hash 漂移");

    const exactCanonicalNames = pickProbes(snapshot.mainTags.map((record) => record.canonicalName));
    for (const canonicalName of exactCanonicalNames) {
        const row = database.query("SELECT canonical_name FROM main_tags WHERE canonical_name = ?").get(canonicalName);
        if (requiredText(row, "canonical_name") !== canonicalName) throw buildError("SQLite exact probe 失败");
    }
    const aliasAntecedentNames = pickProbes(snapshot.aliases.map((record) => record.antecedentName));
    for (const antecedentName of aliasAntecedentNames) {
        const row = database.query(`
            SELECT main_tags.canonical_name AS canonical_name
            FROM aliases JOIN main_tags ON main_tags.tag_id = aliases.consequent_tag_id
            WHERE aliases.antecedent_name = ?
        `).get(antecedentName);
        if (!row) throw buildError("SQLite alias probe 失败");
    }
    const searchRecords = pickProbeRecords(snapshot.mainTags);
    for (const record of searchRecords) {
        const query = `"${record.canonicalName.replaceAll("\"", "\"\"")}"`;
        const row = database.query("SELECT rowid FROM tag_fts WHERE tag_fts MATCH ? AND rowid = ?")
            .get(query, record.tagId);
        if (requiredCount(row, "rowid") !== record.tagId) throw buildError("SQLite FTS probe 失败");
    }
    const probes = {
        exactCanonicalNames,
        aliasAntecedentNames,
        searchCanonicalNames: searchRecords.map((record) => record.canonicalName),
    };
    return {
        validation: {
            sqliteIntegrity: "ok",
            foreignKeyViolationCount: 0,
            ftsRowCount,
            exactProbeCount: exactCanonicalNames.length,
            aliasProbeCount: aliasAntecedentNames.length,
            searchProbeCount: searchRecords.length,
        },
        probes,
    };
}

/** 构造包含逐页 provenance、资源闭合和八工件 hash 的 source manifest。 */
function buildManifest(input: {
    snapshot: TagIndexSourceSnapshot;
    normalized: TagIndexNormalizedSnapshot;
    terms: z.output<typeof TermsInputSchema>;
    artifacts: Artifact[];
    validation: TagIndexBuildValidation;
}): TagIndexManifest {
    const sourceRecordCount = input.snapshot.tags.length + input.snapshot.aliases.length + input.snapshot.implications.length;
    return TagIndexManifestSchema.parse({
        schemaVersion: "nbook.tag-index-manifest/v1",
        indexVersion: input.normalized.indexVersion,
        builderVersion: TAG_INDEX_BUILDER_VERSION,
        normalizerVersion: input.normalized.normalizerVersion,
        sourceClientVersion: input.normalized.sourceClientVersion,
        capabilityVersion: input.normalized.capabilityVersion,
        normalizedHash: input.normalized.normalizedHash,
        sourceKind: "danbooru-api",
        sourceEndpoint: "https://danbooru.donmai.us",
        apiVersion: "json-v1",
        minPostCount: 3000,
        fetchedAt: input.snapshot.fetchedAt,
        snapshotDate: input.snapshot.fetchedAt.slice(0, 10),
        terms: {
            termsUrl: "https://danbooru.donmai.us/terms_of_service",
            attributionUrl: "https://danbooru.donmai.us/",
            ...input.terms,
        },
        sourceResponse: {
            schemaVersion: "danbooru-json-v1",
            contentType: "application/json",
            compression: "transport-decoded",
        },
        sourcePages: [...input.snapshot.pages].sort(comparePages),
        resources: {
            tags: buildResourceManifest(input.snapshot, "tags"),
            aliases: buildResourceManifest(input.snapshot, "aliases"),
            implications: buildResourceManifest(input.snapshot, "implications"),
        },
        counts: {
            sourceRecordCount,
            normalizedRecordCount: normalizedRecordCount(input.normalized),
            indexedProvenanceCount: input.normalized.mainTags.length
                + input.normalized.deprecatedTags.length
                + input.normalized.aliases.length
                + input.normalized.implications.length,
            uniqueCanonicalTagCount: input.normalized.mainTags.length + input.normalized.deprecatedTags.length,
            mainTagCount: input.normalized.mainTags.length,
            deprecatedTagCount: input.normalized.deprecatedTags.length,
            auxiliaryEndpointCount: input.normalized.auxiliaryEndpoints.length,
            aliasCount: input.normalized.aliases.length,
            implicationCount: input.normalized.implications.length,
            duplicateCount: input.normalized.counts.duplicateCount,
            conflictCount: input.normalized.counts.conflictCount,
            rejectedCount: input.normalized.counts.rejectedCount,
        },
        artifacts: input.artifacts,
        validation: input.validation,
        state: "ready",
    });
}

/** 校验 source page 的双轮 record coverage、watermark 与 identity。 */
function assertSourceCoverage(snapshot: TagIndexSourceSnapshot): void {
    const identities = snapshot.pages.map((page) => page.pageIdentity);
    if (new Set(identities).size !== identities.length) throw buildError("source page identity 重复");
    for (const resource of TagIndexSourceResourceSchema.options) {
        const expectedCount = sourceRecords(snapshot, resource).length;
        for (const pass of TagIndexSourcePassSchema.options) {
            const pages = snapshot.pages.filter((page) => page.resource === resource && page.pass === pass);
            const recordCount = pages.reduce((sum, page) => sum + page.recordCount, 0);
            const watermarks = new Set(pages.map((page) => page.watermark));
            if (pages.length === 0 || recordCount !== expectedCount || watermarks.size !== 1) {
                throw buildError(`${resource}/${pass} page coverage 未闭合`);
            }
        }
    }
}

/** 重新 normalizer，拒绝调用方提交与 source 不同的派生 snapshot。 */
function assertNormalizedSnapshot(snapshot: TagIndexSourceSnapshot, normalized: TagIndexNormalizedSnapshot): void {
    const expected = normalizeTagIndexSnapshot({snapshot, capabilityVersion: normalized.capabilityVersion});
    if (canonicalizeTextToImageContract(expected) !== canonicalizeTextToImageContract(normalized)) {
        throw buildError("normalized snapshot 与 source facts 不一致");
    }
}

/** 生成一个资源的双轮汇总。 */
function buildResourceManifest(snapshot: TagIndexSourceSnapshot, resource: "tags" | "aliases" | "implications") {
    const records = sourceRecords(snapshot, resource);
    const ids = records.map((record) => record.id).sort((left, right) => left - right);
    const sourcePages = snapshot.pages.filter((page) => page.resource === resource && page.pass === "source");
    const reconciliationPages = snapshot.pages.filter((page) => page.resource === resource && page.pass === "reconciliation");
    const watermark = sourcePages[0]?.watermark;
    if (!watermark || reconciliationPages.some((page) => page.watermark !== watermark)) {
        throw buildError(`${resource} watermark 漂移`);
    }
    const resourceHash = hashTextToImageContract({resource, records: [...records].sort((left, right) => left.id - right.id)});
    return {
        watermark,
        pageCount: sourcePages.length,
        firstId: ids[0],
        lastId: ids.at(-1),
        sourceRecordCount: records.length,
        reconciliationRecordCount: records.length,
        sourceHash: resourceHash,
        reconciliationHash: resourceHash,
        consistency: "reconciled" as const,
    };
}

/** 读取对应官方资源记录。 */
function sourceRecords(snapshot: TagIndexSourceSnapshot, resource: "tags" | "aliases" | "implications") {
    if (resource === "tags") return snapshot.tags;
    if (resource === "aliases") return snapshot.aliases;
    return snapshot.implications;
}

/** 写 canonical JSON 工件并冻结 exact bytes hash。 */
async function writeJsonArtifact(
    root: string,
    kind: ArtifactKind,
    relativePath: ArtifactPath,
    value: TextToImageContractValue,
    recordCount: number,
): Promise<Artifact> {
    const content = renderCanonicalJson(value);
    const filePath = path.join(root, relativePath);
    await writeFsynced(filePath, content);
    return {
        kind,
        relativePath,
        recordCount,
        byteLength: Buffer.byteLength(content, "utf8"),
        hash: hashBytes(content),
    };
}

/** 对已关闭的 SQLite 文件记录 exact bytes/hash。 */
async function inspectArtifact(
    filePath: string,
    kind: ArtifactKind,
    relativePath: ArtifactPath,
    recordCount: number,
): Promise<Artifact> {
    const bytes = await fs.readFile(filePath);
    return {kind, relativePath, recordCount, byteLength: bytes.byteLength, hash: hashBytes(bytes)};
}

/** 同 indexVersion 已存在时，manifest 与实际八工件必须逐 byte hash 一致。 */
async function assertExistingVersion(versionRoot: string, manifest: TagIndexManifest, manifestHash: string): Promise<void> {
    try {
        const manifestBytes = await fs.readFile(path.join(versionRoot, "source-manifest.json"));
        const existingValue: unknown = JSON.parse(manifestBytes.toString("utf8"));
        const existing = TagIndexManifestSchema.parse(existingValue);
        if (hashBytes(manifestBytes) !== manifestHash
            || canonicalizeTextToImageContract(existing) !== canonicalizeTextToImageContract(manifest)) {
            throw buildError("同 indexVersion source manifest 冲突");
        }
        for (const artifact of existing.artifacts) {
            const bytes = await fs.readFile(path.join(versionRoot, artifact.relativePath));
            if (bytes.byteLength !== artifact.byteLength || hashBytes(bytes) !== artifact.hash) {
                throw buildError(`同 indexVersion 工件已漂移：${artifact.relativePath}`);
            }
        }
    } catch (error) {
        if (error instanceof TagIndexError) throw error;
        throw buildError("同 indexVersion 已存在但无法验证", error);
    }
}

/** 失败目录仅写脱敏诊断，不伪造 ready source manifest。 */
async function writeFailureReport(stagingRoot: string, indexVersion: string, error: unknown): Promise<void> {
    const report = {
        schemaVersion: "nbook.tag-index-build-failure/v1",
        indexVersion,
        failedAt: new Date().toISOString(),
        code: error instanceof TagIndexError ? error.code : "TAG_INDEX_BUILD_FAILED",
        message: (error instanceof Error ? error.message : "Tag index builder 失败").slice(0, 1000),
    };
    try {
        await writeFsynced(path.join(stagingRoot, "build-failure.json"), renderCanonicalJson(report));
    } catch {
        // 原构建错误优先；staging 目录本身仍保留用于现场诊断。
    }
}

/** 主、deprecated、closure 与关系行总数。 */
function normalizedRecordCount(snapshot: TagIndexNormalizedSnapshot): number {
    return snapshot.mainTags.length + snapshot.deprecatedTags.length + snapshot.auxiliaryEndpoints.length
        + snapshot.aliases.length + snapshot.implications.length;
}

/** 从稳定序列选择首/中/尾最多三个探针。 */
function pickProbes(values: string[]): string[] {
    if (values.length <= 3) return [...values];
    return [values[0]!, values[Math.floor(values.length / 2)]!, values.at(-1)!];
}

/** 从 Tag 记录选择首/中/尾最多三个探针。 */
function pickProbeRecords(records: TagIndexNormalizedSnapshot["mainTags"]) {
    if (records.length <= 3) return [...records];
    return [records[0]!, records[Math.floor(records.length / 2)]!, records.at(-1)!];
}

/** 稳定 source page 排序。 */
function comparePages(left: TagIndexPageProvenance, right: TagIndexPageProvenance): number {
    return TagIndexSourcePassSchema.options.indexOf(left.pass) - TagIndexSourcePassSchema.options.indexOf(right.pass)
        || TagIndexSourceResourceSchema.options.indexOf(left.resource) - TagIndexSourceResourceSchema.options.indexOf(right.resource)
        || left.cursorStart - right.cursorStart;
}

/** SQLite 单行文本字段收窄。 */
function requiredText(row: {[column: string]: null | number | bigint | string | Uint8Array} | null, column: string): string {
    const value = row?.[column];
    if (typeof value !== "string") throw buildError(`SQLite ${column} 字段类型非法`);
    return value;
}

/** SQLite count/rowid 字段收窄为安全整数。 */
function requiredCount(
    row: {[column: string]: null | number | bigint | string | Uint8Array} | null,
    column = "count",
): number {
    const value = row?.[column];
    const numberValue = typeof value === "bigint" ? Number(value) : value;
    if (typeof numberValue !== "number" || !Number.isSafeInteger(numberValue) || numberValue < 0) {
        throw buildError(`SQLite ${column} 字段类型非法`);
    }
    return numberValue;
}

/** canonical JSON bytes；对象 key 排序、数组顺序保留。 */
function renderCanonicalJson(value: TextToImageContractValue): string {
    return `${canonicalizeTextToImageContract(value)}\n`;
}

/** 精确 bytes SHA-256。 */
function hashBytes(value: string | Uint8Array): string {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** 新 staging 中 create-only 写入并 fsync。 */
async function writeFsynced(filePath: string, content: string): Promise<void> {
    const handle = await fs.open(filePath, "wx", 0o600);
    try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
}

/** 只接受明确 cache root，所有派生路径随后由固定 indexVersion 组成。 */
function resolveBuildRoot(root: string): string {
    const normalized = root.trim();
    if (!normalized || normalized.includes("\0")) throw new Error("Tag index build root 非法");
    return path.resolve(normalized);
}

/** 无副作用判断路径是否存在。 */
async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (isFsError(error, "ENOENT")) return false;
        throw error;
    }
}

/** 稳定构建错误出口。 */
function buildError(message: string, cause?: unknown): TagIndexError {
    return new TagIndexError({
        code: "TAG_INDEX_BUILD_FAILED",
        message,
        ...(cause instanceof Error ? {cause} : {}),
    });
}

/** 判断 Node 文件系统错误码。 */
function isFsError(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
