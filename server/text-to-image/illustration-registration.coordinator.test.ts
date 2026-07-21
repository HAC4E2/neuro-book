import {describe, expect, it} from "vitest";
import {IllustrationExecutionRegistrationReceiptSchema} from "nbook/shared/text-to-image-execution";
import type {PreparedIllustrationRegistration} from "nbook/server/text-to-image/execution.repository";
import {
    IllustrationRegistrationCoordinator,
    type IllustrationRegistrationPreparationPort,
    type PreparedDispatchBatch,
    type PreparedDispatchStamp,
} from "nbook/server/text-to-image/illustration-registration.coordinator";
import {illustrationRegistrationFixture} from "nbook/server/text-to-image/execution.test-fixtures";

describe("IllustrationRegistrationCoordinator", () => {
    it("leaves App intents inert when the Project transaction fails", async () => {
        const app = new MemoryPreparationPort();
        const coordinator = new IllustrationRegistrationCoordinator({
            preparation: app,
            project: {async register() { throw new Error("project unavailable"); }},
        });

        await expect(coordinator.register(illustrationRegistrationFixture(2))).rejects.toThrow("project unavailable");
        expect(app.prepared?.jobs).toHaveLength(2);
        expect(app.commitCalls).toBe(0);
        expect(app.readyCalls).toBe(0);
    });

    it("returns the committed receipt as dispatch_pending when App ready promotion fails", async () => {
        const app = new MemoryPreparationPort({failReady: true});
        const coordinator = new IllustrationRegistrationCoordinator({
            preparation: app,
            project: {async register(projection) { return receiptFixture(projection); }},
        });

        const receipt = await coordinator.register(illustrationRegistrationFixture(2));

        expect(receipt.dispatchState).toBe("dispatch_pending");
        expect(receipt.registrationState).toBe("jobs_registered");
        expect(app.commitCalls).toBe(1);
        expect(app.readyCalls).toBe(1);
    });

    it("converges a repeated authorization onto the same preparation and ready receipt", async () => {
        const app = new MemoryPreparationPort();
        let projectReceipt: ReturnType<typeof receiptFixture> | null = null;
        const coordinator = new IllustrationRegistrationCoordinator({
            preparation: app,
            project: {async register(projection) { return projectReceipt ??= receiptFixture(projection); }},
        });
        const input = illustrationRegistrationFixture(2);

        const first = await coordinator.register(input);
        const repeated = await coordinator.register({...input, approvedAt: "2026-07-21T00:01:00.000Z"});

        expect(first.dispatchState).toBe("ready");
        expect(repeated).toEqual(first);
        expect(app.preparationIds).toEqual([app.preparationIds[0], app.preparationIds[0]]);
    });
});

class MemoryPreparationPort implements IllustrationRegistrationPreparationPort {
    prepared: PreparedDispatchBatch | null = null;
    preparationIds: string[] = [];
    commitCalls = 0;
    readyCalls = 0;

    constructor(private readonly options: {failReady?: boolean} = {}) {}

    async prepare(batch: PreparedDispatchBatch): Promise<PreparedDispatchStamp> {
        this.prepared ??= batch;
        this.preparationIds.push(batch.preparationId);
        return {
            preparationId: batch.preparationId,
            prepareAttemptId: "prepare-attempt-1",
            prepareLeaseUntil: "2026-07-21T00:01:00.000Z",
            prepareVersion: 1,
        };
    }

    async projectCommitted(): Promise<boolean> {
        this.commitCalls += 1;
        return true;
    }

    async ready(): Promise<boolean> {
        this.readyCalls += 1;
        if (this.options.failReady) throw new Error("injected ready failure");
        return true;
    }
}

/** 构造 Project 已提交、尚待 App promotion 的稳定 receipt。 */
function receiptFixture(projection: PreparedIllustrationRegistration) {
    return IllustrationExecutionRegistrationReceiptSchema.parse({
        schemaVersion: "nbook.illustration-execution-registration-receipt/v1",
        manifestId: projection.manifestId,
        executionManifestHash: projection.input.executionManifestHash,
        approvalId: projection.approvalId,
        approvalHash: projection.approvalHash,
        registrationState: "jobs_registered",
        dispatchState: "dispatch_pending",
        jobIds: projection.jobs.map((job) => job.id),
        dispatchKeys: projection.jobs.map((job) => job.dispatchKey),
        registeredAt: "2026-07-21T00:00:00.000Z",
    });
}
