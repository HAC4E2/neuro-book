import {describe, expect, it} from "vitest";
import {
    ProviderRevisionInvalidationReconciler,
    type ProviderRevisionInvalidationStore,
} from "nbook/server/text-to-image/provider-revision-invalidation.reconciler";
import type {TextToImageProviderRevisionInvalidationRecord} from "nbook/server/text-to-image/provider.service";

describe("ProviderRevisionInvalidationReconciler", () => {
    it("逐条隔离 Project 同步失败，并保留 pending saga 供下轮恢复", async () => {
        const records = [record("first", 1), record("second", 2)];
        const completed: string[] = [];
        const failed: Array<{id: string; message: string}> = [];
        const store: ProviderRevisionInvalidationStore = {
            async findPendingRevisionInvalidations(limit) {
                return records.slice(0, limit);
            },
            async completeRevisionInvalidation(id) {
                completed.push(id);
                return true;
            },
            async failRevisionInvalidation(id, message) {
                failed.push({id, message});
                return true;
            },
        };
        const reconciler = new ProviderRevisionInvalidationReconciler({
            store,
            project: {
                async invalidateRevision(target) {
                    if (target.oldRevision === 2) throw new Error("project busy");
                    return [];
                },
            },
        });

        await expect(reconciler.runOnce(10)).resolves.toEqual({claimed: 2, completed: 1, failed: 1});
        expect(completed).toEqual(["first"]);
        expect(failed).toEqual([{id: "second", message: "project busy"}]);
    });
});

function record(id: string, oldRevision: number): TextToImageProviderRevisionInvalidationRecord {
    const now = new Date("2026-07-21T00:00:00.000Z");
    return {
        id,
        ownerUserId: 1,
        providerId: 2,
        oldRevision,
        newRevision: oldRevision + 1,
        projectId: `project-${oldRevision}`,
        projectPath: `workspace/project-${oldRevision}`,
        state: "pending",
        attemptCount: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
    };
}
