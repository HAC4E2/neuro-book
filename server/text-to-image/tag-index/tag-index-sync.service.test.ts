import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {
    TagSourcePage,
    TagSourcePass,
    TagSourceReader,
    TagSourceResource,
} from "nbook/server/text-to-image/tag-index/tag-source-client";
import {
    TAG_INDEX_SOURCE_ENDPOINT,
    TAG_INDEX_SOURCE_KIND,
} from "nbook/shared/text-to-image-tag-index";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";
import {TagIndexSyncService} from "nbook/server/text-to-image/tag-index/tag-index-sync.service";

const HASH_A = `sha256:${"a".repeat(64)}`;
const WATERMARKS = {tags: 2, aliases: 1, implications: 1} as const;

/** 构造两轮一致的最小 source reader。 */
function sourceReader(options: {failOnceAt?: TagSourceResource; driftReconciliation?: boolean} = {}): {
    reader: TagSourceReader;
    calls: Array<{resource: TagSourceResource; pass: TagSourcePass}>;
} {
    let failed = false;
    const calls: Array<{resource: TagSourceResource; pass: TagSourcePass}> = [];
    const reader: TagSourceReader = {
        descriptor: {
            kind: TAG_INDEX_SOURCE_KIND,
            endpoint: TAG_INDEX_SOURCE_ENDPOINT,
            clientVersion: "test-source-v1",
            providedResources: ["tags", "aliases", "implications"],
        },
        readWatermark: vi.fn(async (resource) => WATERMARKS[resource]),
        readPage: vi.fn(async (input) => {
            calls.push({resource: input.resource, pass: input.pass});
            if (options.failOnceAt === input.resource && !failed) {
                failed = true;
                throw Object.assign(new Error("temporary unavailable"), {code: "TAG_INDEX_SOURCE_UNAVAILABLE"});
            }
            const common = {
                nextCursor: WATERMARKS[input.resource],
                done: true,
                provenance: {
                    resource: input.resource,
                    pass: input.pass,
                    pageIdentity: `${input.resource}.${input.pass}.0.${WATERMARKS[input.resource]}`,
                    cursorStart: 0,
                    cursorEnd: WATERMARKS[input.resource],
                    watermark: WATERMARKS[input.resource],
                    recordCount: input.resource === "tags" ? 2 : 1,
                    byteLength: 100,
                    contentType: "application/json" as const,
                    hash: HASH_A,
                },
            };
            if (input.resource === "tags") {
                const driftedName = options.driftReconciliation && input.pass === "reconciliation" ? "rain_changed" : "rain";
                return {
                    resource: "tags",
                    records: [
                        {
                            id: 1,
                            name: driftedName,
                            categoryId: 0,
                            postCount: 3000,
                            isDeprecated: false,
                            createdAt: "2026-07-20T00:00:00.000Z",
                            updatedAt: "2026-07-20T00:00:00.000Z",
                        },
                        {
                            id: 2,
                            name: "wide_shot",
                            categoryId: 0,
                            postCount: 100000,
                            isDeprecated: false,
                            createdAt: "2026-07-20T00:00:00.000Z",
                            updatedAt: "2026-07-20T00:00:00.000Z",
                        },
                    ],
                    ...common,
                } satisfies TagSourcePage;
            }
            return {
                resource: input.resource,
                records: [{
                    id: 1,
                    antecedentName: input.resource === "aliases" ? "wide_view" : "rain",
                    consequentName: input.resource === "aliases" ? "wide_shot" : "weather",
                    createdAt: "2026-07-20T00:00:00.000Z",
                    updatedAt: "2026-07-20T00:00:00.000Z",
                }],
                ...common,
            } satisfies TagSourcePage;
        }),
    };
    return {reader, calls};
}

describe("TagIndexSyncService", () => {
    let root = "";
    let now = 1_784_505_600_000;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-tag-sync-"));
    });

    afterEach(async () => {
        await fs.rm(root, {recursive: true, force: true});
    });

    it("persists two complete passes and reaches source_verified without activating", async () => {
        const store = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        const {reader, calls} = sourceReader();
        const service = new TagIndexSyncService({
            store,
            sourceClient: reader,
            now: () => now,
            workerId: "worker-a",
            idFactory: () => "tag-sync-a",
        });
        const operation = await service.start({termsConfirmationVersion: "terms-v1"});

        const completed = await service.run(operation.operationId);

        expect(completed.state).toBe("source_verified");
        expect(completed.source.watermarks).toEqual(WATERMARKS);
        expect(calls).toEqual([
            {resource: "tags", pass: "source"},
            {resource: "aliases", pass: "source"},
            {resource: "implications", pass: "source"},
            {resource: "tags", pass: "reconciliation"},
            {resource: "aliases", pass: "reconciliation"},
            {resource: "implications", pass: "reconciliation"},
        ]);
        expect(await store.readActivePointer()).toBeNull();
        expect((await store.readSourcePages(operation.operationId))).toHaveLength(6);
    });

    it("fails reconciliation on normalized fact drift and preserves current.json bytes", async () => {
        const store = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        const {reader} = sourceReader({driftReconciliation: true});
        const service = new TagIndexSyncService({
            store,
            sourceClient: reader,
            now: () => now,
            workerId: "worker-a",
            idFactory: () => "tag-sync-a",
        });
        const operation = await service.start({termsConfirmationVersion: "terms-v1"});

        const failed = await service.run(operation.operationId);

        expect(failed).toEqual(expect.objectContaining({
            state: "failed",
            error: expect.objectContaining({code: "TAG_INDEX_RECONCILIATION_FAILED"}),
        }));
        await expect(fs.readFile(path.join(root, "current.json"), "utf8")).rejects.toMatchObject({code: "ENOENT"});
    });

    it("retries the same operation from its last complete page after a transient failure", async () => {
        const store = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        const firstReader = sourceReader({failOnceAt: "aliases"});
        const firstService = new TagIndexSyncService({
            store,
            sourceClient: firstReader.reader,
            now: () => now,
            workerId: "worker-a",
            idFactory: () => "tag-sync-a",
        });
        const operation = await firstService.start({termsConfirmationVersion: "terms-v1"});
        expect((await firstService.run(operation.operationId)).state).toBe("failed");
        expect(firstReader.calls).toEqual([
            {resource: "tags", pass: "source"},
            {resource: "aliases", pass: "source"},
        ]);

        now += 60_001;
        const secondReader = sourceReader();
        const secondService = new TagIndexSyncService({
            store,
            sourceClient: secondReader.reader,
            now: () => now,
            workerId: "worker-b",
            idFactory: () => "unused-new-operation",
        });
        await secondService.retry(operation.operationId);
        const completed = await secondService.run(operation.operationId);

        expect(completed.state).toBe("source_verified");
        expect(secondReader.calls[0]).toEqual({resource: "aliases", pass: "source"});
        expect(secondReader.calls).not.toContainEqual({resource: "tags", pass: "source"});
    });

    it("cancels before network work and keeps the operation terminal", async () => {
        const store = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        const {reader} = sourceReader();
        const service = new TagIndexSyncService({
            store,
            sourceClient: reader,
            now: () => now,
            workerId: "worker-a",
            idFactory: () => "tag-sync-a",
        });
        const operation = await service.start({termsConfirmationVersion: "terms-v1"});

        expect((await service.cancel(operation.operationId)).state).toBe("canceled");
        expect((await service.run(operation.operationId)).state).toBe("canceled");
        expect(reader.readWatermark).not.toHaveBeenCalled();
    });

    it("cancels a source_verified operation before the local builder claims it", async () => {
        const store = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        const {reader} = sourceReader();
        const service = new TagIndexSyncService({
            store,
            sourceClient: reader,
            now: () => now,
            workerId: "worker-a",
            idFactory: () => "tag-sync-a",
        });
        const operation = await service.start({termsConfirmationVersion: "terms-v1"});
        expect((await service.run(operation.operationId)).state).toBe("source_verified");

        expect((await service.cancel(operation.operationId)).state).toBe("canceled");
        expect((await store.readOperation(operation.operationId)).state).toBe("canceled");
    });
});
