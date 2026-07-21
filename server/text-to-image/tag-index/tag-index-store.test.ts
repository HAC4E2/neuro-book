import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";

describe("TagIndexStore", () => {
    let root = "";
    let now = 1_784_505_600_000;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-tag-store-"));
    });

    afterEach(async () => {
        await fs.rm(root, {recursive: true, force: true});
    });

    it("creates one active operation pointer under concurrent starts", async () => {
        const storeA = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        const storeB = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});

        const [left, right] = await Promise.all([
            storeA.startOperation({operationId: "tag-sync-a", termsConfirmationVersion: "terms-v1"}),
            storeB.startOperation({operationId: "tag-sync-b", termsConfirmationVersion: "terms-v1"}),
        ]);

        expect(left.operationId).toBe(right.operationId);
        expect((await storeA.readActiveOperation())?.operationId).toBe(left.operationId);
        const operationDirectories = await fs.readdir(path.join(root, "operations"));
        expect(operationDirectories.filter((entry) => entry !== "active.json")).toHaveLength(1);
    });

    it("claims an expired lease with a higher fencing version and rejects the stale writer", async () => {
        const storeA = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        const storeB = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});
        const operation = await storeA.startOperation({operationId: "tag-sync-a", termsConfirmationVersion: "terms-v1"});
        const first = await storeA.claimOperation(operation.operationId, "worker-a", 1000);
        expect(first.lease?.fencingVersion).toBe(1);

        now += 1001;
        const second = await storeB.claimOperation(operation.operationId, "worker-b", 1000);
        expect(second.lease?.fencingVersion).toBe(2);
        await expect(storeA.checkpoint({...first, updatedAt: new Date(now).toISOString()}))
            .rejects.toMatchObject({code: "TAG_INDEX_SYNC_INCOMPLETE"});
    });

    it("reclaims only an expired short file lock", async () => {
        await fs.mkdir(root, {recursive: true});
        await fs.writeFile(path.join(root, ".operation.lock"), `${JSON.stringify({
            schemaVersion: "nbook.tag-index-file-lock/v1",
            ownerToken: "00000000-0000-4000-8000-000000000001",
            expiresAt: new Date(now - 1).toISOString(),
        })}\n`, "utf8");
        const store = new TagIndexStore({root, now: () => now, lockRetryDelayMs: 1});

        const operation = await store.startOperation({operationId: "tag-sync-a", termsConfirmationVersion: "terms-v1"});

        expect(operation.operationId).toBe("tag-sync-a");
        await expect(fs.access(path.join(root, ".operation.lock"))).rejects.toMatchObject({code: "ENOENT"});
    });
});
