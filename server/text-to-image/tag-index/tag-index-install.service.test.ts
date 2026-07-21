import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {
    DanbooruSourcePage,
    DanbooruSourceReader,
} from "nbook/server/text-to-image/tag-index/danbooru-source-client";
import {TagIndexInstallService} from "nbook/server/text-to-image/tag-index/tag-index-install.service";
import {TagIndexReader} from "nbook/server/text-to-image/tag-index/tag-index-reader";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";
import {
    createTagIndexTestSnapshot,
    createTagIndexTestTerms,
} from "nbook/server/text-to-image/tag-index/tag-index-test-fixture";

/** 把已闭合 fixture 投影成两轮 official reader。 */
function createSourceReader(): DanbooruSourceReader {
    const snapshot = createTagIndexTestSnapshot();
    return {
        readWatermark: vi.fn(async (resource) => {
            const page = snapshot.pages.find((candidate) => candidate.resource === resource && candidate.pass === "source");
            if (!page) throw new Error(`缺少 ${resource} watermark fixture`);
            return page.watermark;
        }),
        readPage: vi.fn(async (input): Promise<DanbooruSourcePage> => {
            const provenance = snapshot.pages.find((candidate) => candidate.resource === input.resource
                && candidate.pass === input.pass);
            if (!provenance) throw new Error(`缺少 ${input.resource}/${input.pass} page fixture`);
            const common = {nextCursor: provenance.watermark, done: true, provenance};
            if (input.resource === "tags") return {resource: "tags", records: snapshot.tags, ...common};
            return {resource: input.resource, records: snapshot[input.resource], ...common};
        }),
    };
}

describe("TagIndexInstallService", () => {
    let root = "";

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-tag-install-"));
    });

    afterEach(async () => {
        await fs.rm(root, {recursive: true, force: true});
    });

    it("runs source, normalization, indexing, validation and CAS activation as one resumable operation", async () => {
        const store = new TagIndexStore({root, lockRetryDelayMs: 1});
        const service = new TagIndexInstallService({
            store,
            sourceClient: createSourceReader(),
            workerId: "install-worker",
            idFactory: () => "install-operation",
            capabilityVersion: "nai-cap-v1",
            terms: createTagIndexTestTerms(),
        });
        const started = await service.start({termsConfirmationVersion: "terms-confirmation-v1"});

        const completed = await service.run(started.operationId);

        expect(completed.state).toBe("active");
        expect(completed.candidateIndexVersion).toMatch(/^db3k_/u);
        expect(completed.lease).toBeNull();
        const active = await store.readActivePointer();
        expect(active?.indexVersion).toBe(completed.candidateIndexVersion);
        const result = await new TagIndexReader({root}).search({query: "core", limit: 5});
        expect(result.candidates[0]?.canonical.canonicalName).toBe("core_tag");
    });

    it("keeps an already active index serving when the next source operation fails", async () => {
        const store = new TagIndexStore({root, lockRetryDelayMs: 1});
        const first = new TagIndexInstallService({
            store,
            sourceClient: createSourceReader(),
            workerId: "first-worker",
            idFactory: () => "first-operation",
            capabilityVersion: "nai-cap-v1",
            terms: createTagIndexTestTerms(),
        });
        const firstOperation = await first.start({termsConfirmationVersion: "terms-confirmation-v1"});
        await first.run(firstOperation.operationId);
        const currentBefore = await fs.readFile(path.join(root, "current.json"), "utf8");

        const unavailable: DanbooruSourceReader = {
            readWatermark: vi.fn(async () => {
                throw Object.assign(new Error("offline"), {code: "TAG_INDEX_SOURCE_UNAVAILABLE"});
            }),
            readPage: vi.fn(),
        };
        const second = new TagIndexInstallService({
            store,
            sourceClient: unavailable,
            workerId: "second-worker",
            idFactory: () => "second-operation",
            capabilityVersion: "nai-cap-v1",
            terms: createTagIndexTestTerms(),
        });
        const secondOperation = await second.start({termsConfirmationVersion: "terms-confirmation-v1"});
        const failed = await second.run(secondOperation.operationId);

        expect(failed.state).toBe("failed");
        expect(await fs.readFile(path.join(root, "current.json"), "utf8")).toBe(currentBefore);
        await expect(new TagIndexReader({root}).findExact("core_tag"))
            .resolves.toMatchObject({kind: "main", canonical: {canonicalName: "core_tag"}});
    });
});
