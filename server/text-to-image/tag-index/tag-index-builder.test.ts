import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {TagIndexManifestSchema, TagIndexSourceSnapshotSchema, type TagIndexSourceSnapshot} from "nbook/shared/text-to-image-tag-index";
import {buildTagIndexVersion} from "nbook/server/text-to-image/tag-index/tag-index-builder";
import {openTagIndexDatabase} from "nbook/server/text-to-image/tag-index/tag-index-database";
import {normalizeTagIndexSnapshot} from "nbook/server/text-to-image/tag-index/tag-index-normalizer";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

/** 创建隔离的 Workspace Root Tag cache。 */
async function createRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-tag-builder-"));
    roots.push(root);
    return root;
}

/** 构造能覆盖四 tier、deprecated 与关系闭包的 source snapshot。 */
function sourceSnapshot(): TagIndexSourceSnapshot {
    const pages = (["source", "reconciliation"] as const).flatMap((pass) => [
        page("tags", pass, 6, 6),
        page("aliases", pass, 2, 2),
        page("implications", pass, 2, 2),
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
            tag(1, "tail_tag", 3000),
            tag(2, "common_tag", 10000),
            tag(3, "high_tag", 30000),
            tag(4, "core_tag", 100000),
            tag(5, "second_core", 120000),
            tag(6, "deprecated_tag", 5000, true),
        ],
        aliases: [
            relation(1, "legacy_core", "core_tag"),
            relation(2, "deprecated_tag", "tail_tag"),
        ],
        implications: [
            relation(1, "core_tag", "low_weather"),
            relation(2, "tail_tag", "core_tag"),
        ],
        sourceHash: HASH_A,
        reconciliationHash: HASH_A,
    });
}

/** 一个 source page provenance fixture。 */
function page(
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
        hash: HASH_A,
    };
}

/** 一个 official Tag fixture。 */
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

/** 一个 official active relation fixture。 */
function relation(id: number, antecedentName: string, consequentName: string): TagIndexSourceSnapshot["aliases"][number] {
    return {
        id,
        antecedentName,
        consequentName,
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z",
    };
}

/** 固定 terms/attribution 证据。 */
function terms() {
    return {
        contentHash: HASH_B,
        userConfirmationVersion: "terms-confirmation-v1",
        retrievalPolicyVersion: "danbooru-retrieval-v1",
    };
}

describe("TagIndexBuilder", () => {
    it("writes four deterministic tiers, relations, SQLite, report and manifest after validation", async () => {
        const root = await createRoot();
        const snapshot = sourceSnapshot();
        const normalized = normalizeTagIndexSnapshot({snapshot, capabilityVersion: "nai-cap-v1"});

        const result = await buildTagIndexVersion({root, snapshot, normalized, terms: terms()});
        const files = (await readdir(result.versionRoot)).sort();
        expect(files).toEqual([
            "aliases.json",
            "build-report.json",
            "implications.json",
            "source-manifest.json",
            "tags.common.json",
            "tags.core.json",
            "tags.high.json",
            "tags.sqlite",
            "tags.tail.json",
        ]);

        const manifestValue: unknown = JSON.parse(await readFile(join(result.versionRoot, "source-manifest.json"), "utf8"));
        const manifest = TagIndexManifestSchema.parse(manifestValue);
        expect(manifest.indexVersion).toBe(normalized.indexVersion);
        expect(manifest.artifacts).toHaveLength(8);
        expect(manifest.validation).toMatchObject({sqliteIntegrity: "ok", foreignKeyViolationCount: 0, ftsRowCount: 5});

        const database = await openTagIndexDatabase(join(result.versionRoot, "tags.sqlite"), {readOnly: true});
        try {
            expect(database.query("SELECT canonical_name FROM main_tags WHERE canonical_name = ?").get("tail_tag"))
                .toEqual({canonical_name: "tail_tag"});
            expect(database.query(`
                SELECT main_tags.canonical_name
                FROM aliases JOIN main_tags ON main_tags.tag_id = aliases.consequent_tag_id
                WHERE aliases.antecedent_name = ?
            `).get("legacy_core")).toEqual({canonical_name: "core_tag"});
            expect(database.query("SELECT canonical_name FROM tag_fts WHERE tag_fts MATCH ?").all('"core"*'))
                .toHaveLength(2);
            expect(database.query("SELECT COUNT(*) AS count FROM deprecated_tags").get()).toEqual({count: 1});
            expect(database.query("SELECT COUNT(*) AS count FROM auxiliary_endpoints").get()).toEqual({count: 2});
        } finally {
            database.close();
        }
    });

    it("is idempotent only while every existing artifact still matches its manifest", async () => {
        const root = await createRoot();
        const snapshot = sourceSnapshot();
        const normalized = normalizeTagIndexSnapshot({snapshot, capabilityVersion: "nai-cap-v1"});
        const first = await buildTagIndexVersion({root, snapshot, normalized, terms: terms()});
        const second = await buildTagIndexVersion({root, snapshot, normalized, terms: terms()});
        expect(second.manifestHash).toBe(first.manifestHash);
        expect(second.versionRoot).toBe(first.versionRoot);

        await writeFile(join(first.versionRoot, "tags.core.json"), "corrupted\n", "utf8");
        await expect(buildTagIndexVersion({root, snapshot, normalized, terms: terms()}))
            .rejects.toMatchObject({code: "TAG_INDEX_BUILD_FAILED"});
        expect((await readdir(join(root, ".staging"))).length).toBeGreaterThan(0);
    });

    it("retains a diagnosable failed staging and never writes a ready manifest on coverage failure", async () => {
        const root = await createRoot();
        const snapshot = sourceSnapshot();
        snapshot.pages[0] = {...snapshot.pages[0]!, recordCount: 5};
        const normalized = normalizeTagIndexSnapshot({snapshot, capabilityVersion: "nai-cap-v1"});

        await expect(buildTagIndexVersion({root, snapshot, normalized, terms: terms()}))
            .rejects.toMatchObject({code: "TAG_INDEX_BUILD_FAILED"});
        const stagingEntries = await readdir(join(root, ".staging"));
        expect(stagingEntries).toHaveLength(1);
        const failedRoot = join(root, ".staging", stagingEntries[0]!);
        expect(await readdir(failedRoot)).toContain("build-failure.json");
        await expect(readFile(join(failedRoot, "source-manifest.json"), "utf8")).rejects.toMatchObject({code: "ENOENT"});
    });
});
