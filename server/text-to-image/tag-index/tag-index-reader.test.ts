import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {buildTagIndexVersion} from "nbook/server/text-to-image/tag-index/tag-index-builder";
import {TagIndexReader} from "nbook/server/text-to-image/tag-index/tag-index-reader";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";
import {
    createTagIndexTestSnapshot,
    createTagIndexTestTerms,
} from "nbook/server/text-to-image/tag-index/tag-index-test-fixture";
import {normalizeTagIndexSnapshot} from "nbook/server/text-to-image/tag-index/tag-index-normalizer";

describe("TagIndex activation and reader", () => {
    let root = "";
    let now = 1_784_505_600_000;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-tag-reader-"));
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    /** 构建一个 ready 但尚未 active 的 index。 */
    async function buildReady(capabilityVersion = "nai-cap-v1") {
        const snapshot = createTagIndexTestSnapshot();
        const normalized = normalizeTagIndexSnapshot({snapshot, capabilityVersion});
        return buildTagIndexVersion({root, snapshot, normalized, terms: createTagIndexTestTerms()});
    }

    it("does not scan ready directories when current.json is absent", async () => {
        await buildReady();
        const reader = new TagIndexReader({root});

        await expect(reader.findExact("core_tag")).rejects.toMatchObject({code: "TAG_INDEX_NOT_READY"});
    });

    it("activates by expected current hash and resolves canonical, alias and deprecated facts across all tiers", async () => {
        const ready = await buildReady();
        const store = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        const before = await store.readActivePointerState();
        expect(before).toEqual({pointer: null, pointerHash: null});

        const active = await store.activateVersion({
            indexVersion: ready.manifest.indexVersion,
            manifestHash: ready.manifestHash,
            expectedCurrentHash: null,
        });
        expect(active.pointer.indexVersion).toBe(ready.manifest.indexVersion);
        expect(active.pointerHash).toMatch(/^sha256:/u);

        const reader = new TagIndexReader({root});
        await expect(reader.findExact("tail_tag")).resolves.toMatchObject({
            kind: "main",
            matchedBy: "exact",
            canonical: {tagId: 1, canonicalName: "tail_tag"},
            usageTier: "tail",
            evidence: {indexVersion: ready.manifest.indexVersion, queriedTiers: ["core", "high", "common", "tail"]},
        });
        await expect(reader.findExact("legacy_core")).resolves.toMatchObject({
            kind: "main",
            matchedBy: "alias",
            aliasName: "legacy_core",
            canonical: {tagId: 4, canonicalName: "core_tag"},
        });
        await expect(reader.findExact("deprecated_tag")).resolves.toMatchObject({
            kind: "deprecated",
            canonical: {tagId: 6, canonicalName: "deprecated_tag"},
        });
    });

    it("cascades FTS from core/high to common/tail and freezes the actual tier evidence", async () => {
        const ready = await buildReady();
        const store = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        await store.activateVersion({
            indexVersion: ready.manifest.indexVersion,
            manifestHash: ready.manifestHash,
            expectedCurrentHash: null,
        });
        const reader = new TagIndexReader({root});

        const highFrequency = await reader.search({query: "core", limit: 2});
        expect(highFrequency.candidates.map((candidate) => candidate.canonical.canonicalName)).toEqual(["core_tag", "second_core"]);
        expect(highFrequency.evidence.queriedTiers).toEqual(["core", "high"]);
        expect(highFrequency.evidence.candidateSetHash).toMatch(/^sha256:/u);

        const tail = await reader.search({query: "tail", limit: 2});
        expect(tail.candidates[0]).toMatchObject({canonical: {canonicalName: "tail_tag"}, usageTier: "tail"});
        expect(tail.evidence.queriedTiers).toEqual(["core", "high", "common", "tail"]);

        const related = await reader.findRelated("core_tag", 10);
        expect(related.relations).toEqual([
            {
                relationId: 1,
                direction: "outgoing",
                antecedentName: "core_tag",
                consequentName: "low_weather",
                otherEndpoint: {canonicalName: "low_weather", endpointKind: "auxiliary"},
            },
            {
                relationId: 2,
                direction: "incoming",
                antecedentName: "tail_tag",
                consequentName: "core_tag",
                otherEndpoint: {canonicalName: "tail_tag", endpointKind: "main"},
            },
        ]);
        expect(related.evidence.queriedTiers).toEqual([]);
    });

    it("rejects stale activation CAS and keeps the previous active index serving", async () => {
        const first = await buildReady("nai-cap-v1");
        const second = await buildReady("nai-cap-v2");
        const store = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        const activeFirst = await store.activateVersion({
            indexVersion: first.manifest.indexVersion,
            manifestHash: first.manifestHash,
            expectedCurrentHash: null,
        });

        await expect(store.activateVersion({
            indexVersion: second.manifest.indexVersion,
            manifestHash: second.manifestHash,
            expectedCurrentHash: null,
        })).rejects.toMatchObject({code: "TAG_INDEX_ACTIVATION_CONFLICT"});
        expect((await store.readActivePointerState()).pointer?.indexVersion).toBe(first.manifest.indexVersion);

        now += 1;
        const activeSecond = await store.activateVersion({
            indexVersion: second.manifest.indexVersion,
            manifestHash: second.manifestHash,
            expectedCurrentHash: activeFirst.pointerHash,
        });
        expect(activeSecond.pointer.indexVersion).toBe(second.manifest.indexVersion);
    });

    it("rejects queries after a reader's frozen active identity has changed", async () => {
        const first = await buildReady("nai-cap-v1");
        const second = await buildReady("nai-cap-v2");
        const store = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        const activeFirst = await store.activateVersion({
            indexVersion: first.manifest.indexVersion,
            manifestHash: first.manifestHash,
            expectedCurrentHash: null,
        });
        const reader = new TagIndexReader({
            root,
            expected: {indexVersion: first.manifest.indexVersion, manifestHash: first.manifestHash},
        });
        await expect(reader.findExact("core_tag")).resolves.toMatchObject({kind: "main"});

        now += 1;
        await store.activateVersion({
            indexVersion: second.manifest.indexVersion,
            manifestHash: second.manifestHash,
            expectedCurrentHash: activeFirst.pointerHash,
        });

        await expect(reader.search({query: "core", limit: 2})).rejects.toMatchObject({code: "TAG_INDEX_NOT_READY"});
    });

    it("fails closed when the active SQLite bytes drift from the manifest", async () => {
        const ready = await buildReady();
        const store = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        await store.activateVersion({
            indexVersion: ready.manifest.indexVersion,
            manifestHash: ready.manifestHash,
            expectedCurrentHash: null,
        });
        await writeFile(join(ready.versionRoot, "tags.sqlite"), "corrupted", "utf8");

        const reader = new TagIndexReader({root});
        await expect(reader.findExact("core_tag")).rejects.toMatchObject({code: "TAG_INDEX_NOT_READY"});
    });
});
