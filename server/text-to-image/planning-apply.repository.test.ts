import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {initProjectDatabaseAtRoot, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {PlanningApplyRepository} from "nbook/server/text-to-image/planning-apply.repository";

const H = (digit: string) => `sha256:${digit.repeat(64)}`;

function planningApplyPayloadFixture() {
    return {
        schemaVersion: "nbook.illustration-planning-apply/v1" as const,
        journalId: "apply-1",
        workflowId: "workflow-1",
        projectId: "project-1",
        chapterPath: "manuscript/v1/c1/index.md",
        sourceChapterHash: H("1"),
        planHash: H("2"),
        expectedChapterHash: H("3"),
        expectedStoryboardHash: null,
        storyboardBefore: null,
        stagedStoryboard: "---\nschema: staged\n---\n",
        stagedStoryboardHash: H("4"),
        appliedStoryboard: "---\nschema: applied\n---\n",
        appliedStoryboardHash: H("5"),
        chapterBefore: "正文。\n",
        chapterAfter: "正文。\n\n<text-to-image-prompt id=\"image_prompt_01\">...\n",
        chapterAfterHash: H("6"),
        newPlaceholderIds: ["image_prompt_01"],
        supersededPlaceholderIds: [],
        planningRequestHash: H("7"),
        planningInputHash: H("8"),
        planningEvidenceHash: H("9"),
    };
}

describe("PlanningApplyRepository", () => {
    let root = "";
    let adapter: TrackedPrismaLibSql;
    let client: PrismaClient;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-planning-apply-"));
        const databasePath = await initProjectDatabaseAtRoot(root);
        adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(databasePath)});
        client = new PrismaClient({adapter});
        await client.illustrationPlanningWorkflow.create({
            data: {
                id: "workflow-1",
                projectId: "project-1",
                chapterPath: "manuscript/v1/c1/index.md",
                operation: "plan_chapter",
                planningRequestHash: `sha256:${"7".repeat(64)}`,
                planningInputHash: `sha256:${"8".repeat(64)}`,
                inputJson: "{}",
                status: "applying",
            },
        });
    });

    afterEach(async () => {
        await client.$disconnect();
        adapter.closeTrackedClients();
        collectReleasedSqliteHandles({force: true});
        await fs.rm(root, {recursive: true, force: true});
    });

    it("converges create-only preparation and rejects a conflicting payload", async () => {
        const repository = new PlanningApplyRepository(client);
        const payload = planningApplyPayloadFixture();
        const prepared = await Promise.all(Array.from({length: 8}, () => repository.prepare(payload)));

        expect(new Set(prepared.map((journal) => journal.id)).size).toBe(1);
        expect(await client.illustrationPlanningApplyJournal.count()).toBe(1);
        await expect(repository.prepare({...payload, chapterAfter: "冲突正文"})).rejects.toThrow(/PLANNING_APPLY_CONFLICT/u);
    });

    it("advances with CAS/idempotent replay and exposes only recoverable stages", async () => {
        const repository = new PlanningApplyRepository(client);
        await repository.prepare(planningApplyPayloadFixture());
        await expect(repository.readRecoverable({projectId: "project-1"})).resolves.toHaveLength(1);

        await expect(repository.advance({workflowId: "workflow-1", from: "prepared", to: "storyboard_written"}))
            .resolves.toMatchObject({state: "storyboard_written"});
        await expect(repository.advance({workflowId: "workflow-1", from: "prepared", to: "storyboard_written"}))
            .resolves.toMatchObject({state: "storyboard_written"});
        await repository.advance({workflowId: "workflow-1", from: "storyboard_written", to: "chapter_written"});
        await repository.advance({workflowId: "workflow-1", from: "chapter_written", to: "storyboard_applied"});
        await repository.advance({workflowId: "workflow-1", from: "storyboard_applied", to: "completed"});

        await expect(repository.readRecoverable({projectId: "project-1"})).resolves.toHaveLength(0);
        expect(await client.textToImageJob.count()).toBe(0);
    });

    it("does not permit a stale writer to skip a persisted stage", async () => {
        const repository = new PlanningApplyRepository(client);
        await repository.prepare(planningApplyPayloadFixture());
        await expect(repository.advance({workflowId: "workflow-1", from: "prepared", to: "chapter_written"}))
            .rejects.toThrow(/PLANNING_APPLY_STATE_CONFLICT/u);
        await expect(repository.read("workflow-1")).resolves.toMatchObject({state: "prepared"});
    });
});
