import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createClient} from "@libsql/client";
import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {DispatchPreparationSnapshotSchema} from "nbook/shared/text-to-image-dispatch";
import {ProjectDispatchRepository} from "nbook/server/text-to-image/project-dispatch.repository";
import {prepareIllustrationExecutionRegistration} from "nbook/server/text-to-image/execution.repository";
import {IllustrationExecutionRepository} from "nbook/server/text-to-image/execution.repository";
import {illustrationRegistrationFixture} from "nbook/server/text-to-image/execution.test-fixtures";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {
    initProjectDatabaseAtRoot,
    toSqliteFileUrl,
} from "nbook/server/workspace-files/project-workspace";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";

describe("ProjectDispatchRepository", () => {
    let workspaceRoot = "";

    beforeEach(async () => {
        workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-project-dispatch-"));
    });

    afterEach(async () => {
        collectReleasedSqliteHandles({force: true});
        try {
            await fs.rm(workspaceRoot, {recursive: true, force: true});
        } catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY")) throw error;
        }
    });

    it("reads an exact committed closure without an open Project session", async () => {
        const {snapshot} = await createCommittedProject("demo");
        const repository = new ProjectDispatchRepository({workspaceRoot});

        const inspection = await repository.inspect(snapshot);

        expect(inspection).toMatchObject({kind: "committed", projectPath: "workspace/demo"});
        if (inspection.kind !== "committed") throw new Error("预期 committed inspection");
        expect(inspection.receipt.dispatchKeys).toEqual(snapshot.dispatchKeys);
    });

    it("returns absent only when the exact Project is reachable and has no closure", async () => {
        await createEmptyProject("demo", "project-1");
        const repository = new ProjectDispatchRepository({workspaceRoot});

        await expect(repository.inspect(preparationSnapshot())).resolves.toMatchObject({
            kind: "absent",
            projectPath: "workspace/demo",
        });
    });

    it("relocates only by exact projectId and quarantines ambiguity", async () => {
        const {snapshot} = await createCommittedProject("moved");
        const repository = new ProjectDispatchRepository({workspaceRoot});

        await expect(repository.inspect(snapshot)).resolves.toMatchObject({kind: "committed", projectPath: "workspace/moved"});

        await fs.cp(path.join(workspaceRoot, "moved"), path.join(workspaceRoot, "duplicate"), {recursive: true});
        await expect(repository.inspect(snapshot)).resolves.toMatchObject({kind: "ambiguous"});
    });

    it("rebinds an exact immutable old-version outbox instead of creating a second Job", async () => {
        const {snapshot: oldSnapshot} = await createCommittedProject("demo");
        const currentSnapshot = DispatchPreparationSnapshotSchema.parse({
            ...oldSnapshot,
            prepareAttemptId: "prepare-attempt-2",
            prepareVersion: 2,
            stateVersion: 2,
        });
        const repository = new ProjectDispatchRepository({workspaceRoot});

        await expect(repository.inspect(currentSnapshot)).resolves.toMatchObject({kind: "stale_version"});
        const rebound = await repository.rebind(currentSnapshot, "workspace/demo");

        expect(rebound).toMatchObject({kind: "committed"});
        const client = createClient({url: toSqliteFileUrl(path.join(workspaceRoot, "demo", ".nbook", "project.sqlite"))});
        try {
            const jobs = await client.execute(`SELECT COUNT(*) AS "count" FROM "TextToImageJob"`);
            expect(Number(jobs.rows[0]?.count)).toBe(2);
        } finally {
            await client.close();
        }
    });

    async function createCommittedProject(slug: string) {
        const projectRoot = await createEmptyProject(slug, "project-1");
        const projection = prepareIllustrationExecutionRegistration(illustrationRegistrationFixture(2));
        const stamp = {
            preparationId: projection.preparationId,
            prepareAttemptId: "prepare-attempt-1",
            prepareLeaseUntil: "2099-07-21T00:00:30.000Z",
            prepareVersion: 1,
        };
        const adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(path.join(projectRoot, ".nbook", "project.sqlite"))});
        const prisma = new PrismaClient({adapter});
        try {
            await new IllustrationExecutionRepository(prisma).register(projection, stamp);
        } finally {
            await prisma.$disconnect();
            adapter.closeTrackedClients();
        }
        return {snapshot: preparationSnapshot(), projection};
    }

    async function createEmptyProject(slug: string, projectId: string): Promise<string> {
        const projectRoot = path.join(workspaceRoot, slug);
        await fs.mkdir(projectRoot, {recursive: true});
        const databasePath = await initProjectDatabaseAtRoot(projectRoot);
        const client = createClient({url: toSqliteFileUrl(databasePath)});
        try {
            await client.execute({
                sql: `UPDATE "ProjectMetadata" SET "value" = ? WHERE "key" = 'projectId'`,
                args: [projectId],
            });
        } finally {
            await client.close();
        }
        return projectRoot;
    }
});

/** 与共享注册 fixture 对应的 App preparation snapshot。 */
function preparationSnapshot() {
    const projection = prepareIllustrationExecutionRegistration(illustrationRegistrationFixture(2));
    return DispatchPreparationSnapshotSchema.parse({
        schemaVersion: "nbook.text-to-image-dispatch-preparation/v1",
        id: projection.preparationId,
        ownerUserId: 7,
        providerId: 11,
        providerCredentialRevision: 3,
        projectId: "project-1",
        projectPath: "workspace/demo",
        manifestHash: projection.input.executionManifestHash,
        prepareAttemptId: "prepare-attempt-1",
        prepareLeaseUntil: "2099-07-21T00:00:30.000Z",
        prepareVersion: 1,
        stateVersion: 1,
        state: "prepared",
        jobIds: projection.jobs.map((job) => job.id),
        dispatchKeys: projection.jobs.map((job) => job.dispatchKey),
        quarantineCode: null,
        quarantineMessage: null,
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z",
    });
}
