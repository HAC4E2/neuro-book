import {describe, expect, it} from "vitest";
import type {DispatchPreparationSnapshot} from "nbook/shared/text-to-image-dispatch";
import {
    DispatchReconciler,
    type DispatchReconcilerPreparationPort,
    type DispatchReconcilerProjectPort,
} from "nbook/server/text-to-image/dispatch-reconciler";
import {prepareIllustrationExecutionRegistration} from "nbook/server/text-to-image/execution.repository";
import {illustrationRegistrationFixture} from "nbook/server/text-to-image/execution.test-fixtures";

describe("DispatchReconciler", () => {
    it("promotes exact commit, abandons true absence and quarantines unavailable Project independently", async () => {
        const snapshots = [snapshot("committed"), snapshot("absent"), snapshot("unavailable")];
        const preparation = new FakePreparationPort(snapshots);
        const project: DispatchReconcilerProjectPort = {
            async inspect(current) {
                if (current.projectPath.endsWith("committed")) return {kind: "committed", projectPath: current.projectPath, receipt: receipt(current)};
                if (current.projectPath.endsWith("absent")) return {kind: "absent", projectPath: current.projectPath};
                return {
                    kind: "unavailable",
                    projectPath: current.projectPath,
                    code: "TEXT_TO_IMAGE_PROJECT_UNAVAILABLE",
                    message: "Project 暂不可达",
                };
            },
            async rebind() { throw new Error("unexpected rebind"); },
        };
        const reconciler = new DispatchReconciler({preparation, project});

        const result = await reconciler.runOnce(10);

        expect(result).toEqual({claimed: 3, ready: 1, abandoned: 1, quarantined: 1, failed: 0});
        expect(preparation.promoted).toEqual([snapshots[0]?.id]);
        expect(preparation.abandoned).toEqual([snapshots[1]?.id]);
        expect(preparation.quarantined).toEqual([[snapshots[2]?.id, "TEXT_TO_IMAGE_PROJECT_UNAVAILABLE"]]);
    });

    it("rebinds an exact old-version outbox and updates relocated projectPath before promotion", async () => {
        const current = snapshot("old-path");
        const preparation = new FakePreparationPort([current]);
        const project: DispatchReconcilerProjectPort = {
            async inspect() { return {kind: "stale_version", projectPath: "workspace/moved"}; },
            async rebind(rebound) { return {kind: "committed", projectPath: "workspace/moved", receipt: receipt(rebound)}; },
        };
        const reconciler = new DispatchReconciler({preparation, project});

        await expect(reconciler.runOnce(1)).resolves.toMatchObject({ready: 1});
        expect(preparation.relocated).toEqual([[current.id, "workspace/moved"]]);
        expect(preparation.promoted).toEqual([current.id]);
    });

    it("isolates one damaged preparation so later items still recover", async () => {
        const damaged = snapshot("damaged");
        const healthy = snapshot("healthy");
        const preparation = new FakePreparationPort([damaged, healthy]);
        const project: DispatchReconcilerProjectPort = {
            async inspect(current) {
                if (current.id === damaged.id) throw new Error("damaged database");
                return {kind: "absent", projectPath: current.projectPath};
            },
            async rebind() { throw new Error("unexpected rebind"); },
        };

        await expect(new DispatchReconciler({preparation, project}).runOnce(2)).resolves.toEqual({
            claimed: 2,
            ready: 0,
            abandoned: 1,
            quarantined: 0,
            failed: 1,
        });
        expect(preparation.abandoned).toEqual([healthy.id]);
    });
});

class FakePreparationPort implements DispatchReconcilerPreparationPort {
    promoted: string[] = [];
    abandoned: string[] = [];
    quarantined: Array<[string | undefined, string]> = [];
    relocated: Array<[string, string]> = [];

    constructor(private readonly snapshots: DispatchPreparationSnapshot[]) {}

    async claimExpired(): Promise<DispatchPreparationSnapshot[]> {
        return this.snapshots;
    }

    async relocate(snapshot: DispatchPreparationSnapshot, projectPath: string): Promise<DispatchPreparationSnapshot> {
        this.relocated.push([snapshot.id, projectPath]);
        return {...snapshot, projectPath};
    }

    async promote(snapshot: DispatchPreparationSnapshot): Promise<boolean> {
        this.promoted.push(snapshot.id);
        return true;
    }

    async abandon(snapshot: DispatchPreparationSnapshot): Promise<boolean> {
        this.abandoned.push(snapshot.id);
        return true;
    }

    async quarantine(snapshot: DispatchPreparationSnapshot, code: string): Promise<boolean> {
        this.quarantined.push([snapshot.id, code]);
        return true;
    }
}

function snapshot(slug: string): DispatchPreparationSnapshot {
    const projection = prepareIllustrationExecutionRegistration(illustrationRegistrationFixture(1));
    return {
        schemaVersion: "nbook.text-to-image-dispatch-preparation/v1",
        id: `${projection.preparationId}-${slug}`,
        ownerUserId: 7,
        providerId: 11,
        providerCredentialRevision: 3,
        projectId: "project-1",
        projectPath: `workspace/${slug}`,
        manifestHash: projection.input.executionManifestHash,
        prepareAttemptId: "prepare-attempt-1",
        prepareLeaseUntil: "2026-07-21T00:00:30.000Z",
        prepareVersion: 1,
        stateVersion: 2,
        state: "prepared",
        jobIds: projection.jobs.map((job) => job.id),
        dispatchKeys: projection.jobs.map((job) => job.dispatchKey),
        quarantineCode: null,
        quarantineMessage: null,
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:31.000Z",
    };
}

function receipt(snapshot: DispatchPreparationSnapshot) {
    return {
        schemaVersion: "nbook.illustration-execution-registration-receipt/v1" as const,
        manifestId: "manifest-1",
        executionManifestHash: snapshot.manifestHash,
        approvalId: "approval-1",
        approvalHash: snapshot.manifestHash,
        registrationState: "jobs_registered" as const,
        dispatchState: "dispatch_pending" as const,
        jobIds: snapshot.jobIds,
        dispatchKeys: snapshot.dispatchKeys,
        registeredAt: "2026-07-21T00:00:00.000Z",
    };
}
