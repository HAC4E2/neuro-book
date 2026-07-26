import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {
    ILLUSTRATION_PLAN_VALIDATOR_VERSION,
    type ValidatedIllustrationPlan,
} from "nbook/shared/text-to-image-illustration-planning";
import {
    createIllustrationPlanningInputHash,
    createIllustrationPlanningRequestHash,
    type IllustrationPlanningInputBundle,
} from "nbook/shared/text-to-image-illustration-workflow";
import type {IllustrationPlanningApplyState} from "nbook/shared/text-to-image-planning-apply";
import {createIllustrationPlanningTestBundle} from "nbook/server/text-to-image/illustration-planning-test-fixture";
import {IllustrationChapterParser} from "nbook/server/text-to-image/illustration-chapter-parser";
import {PlanningApplyService} from "nbook/server/text-to-image/planning-apply.service";
import {PlanningApplyRepository} from "nbook/server/text-to-image/planning-apply.repository";
import {parseChapterStoryboardMarkdown} from "nbook/server/text-to-image/chapter-storyboard.codec";
import {closeTextToImageProjectClient, textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {registerProjectResourceOwner, resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {resolveProjectAbsolutePath} from "nbook/server/text-to-image/compat";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";
import {resetWorkspaceHistoryForTest, workspaceHistoryResourceOwner} from "nbook/server/workspace-history/project-history";

const H = (digit: string) => `sha256:${digit.repeat(64)}`;
const CHAPTER_PATH = "manuscript/v1/c1/index.md";
const STORYBOARD_PATH = "manuscript/v1/c1/illustrations.md";
const CHAPTER_MARKDOWN = "港口的晨雾缓缓散开。\n\n少女站在栏杆旁。\n";

describe("PlanningApplyService", () => {
    it("recovers every persisted stage to identical completed bytes", async () => {
        const baseline = await runApplyScenario(null);
        for (const stopAfter of ["prepared", "storyboard_written", "chapter_written", "storyboard_applied"] as const) {
            const recovered = await runApplyScenario(stopAfter);
            expect(recovered.chapter).toBe(baseline.chapter);
            expect(recovered.storyboard).toBe(baseline.storyboard);
            expect(recovered.workflowStatus).toBe("ready");
            expect(recovered.journalState).toBe("completed");
            expect(recovered.jobCount).toBe(0);
        }
    }, 60_000);

    it("rolls back a staged storyboard when the chapter drifts before chapter write", async () => {
        const context = await createContext();
        try {
            const interrupted = new PlanningApplyService({
                client: context.client,
                clock: () => new Date("2026-07-21T02:00:00.000Z"),
                idFactory: fixedIdFactory,
                afterStage: (state) => {
                    if (state === "storyboard_written") throw new Error("TEST_INTERRUPTION");
                },
            });
            await expect(interrupted.applyValidatedPlan({projectPath: context.projectPath, workflowId: "workflow-1"}))
                .rejects.toThrow("TEST_INTERRUPTION");
            await fs.writeFile(context.chapterFile, `${CHAPTER_MARKDOWN}\n作者改写。\n`, "utf8");

            const recovering = new PlanningApplyService({
                client: context.client,
                clock: () => new Date("2026-07-21T02:00:00.000Z"),
                idFactory: fixedIdFactory,
            });
            await recovering.recoverProject({projectPath: context.projectPath, projectId: context.projectId});

            await expect(fs.stat(context.storyboardFile)).rejects.toMatchObject({code: "ENOENT"});
            await expect(new PlanningApplyRepository(context.client).read("workflow-1"))
                .resolves.toMatchObject({state: "rolled_back"});
            await expect(context.client.illustrationPlanningWorkflow.findUniqueOrThrow({where: {id: "workflow-1"}}))
                .resolves.toMatchObject({status: "stale"});
        } finally {
            await disposeContext(context);
        }
    }, 20_000);

    it("keeps the chapter-written batch inert when the storyboard is externally changed", async () => {
        const context = await createContext();
        try {
            const interrupted = new PlanningApplyService({
                client: context.client,
                clock: () => new Date("2026-07-21T02:00:00.000Z"),
                idFactory: fixedIdFactory,
                afterStage: (state) => {
                    if (state === "chapter_written") throw new Error("TEST_INTERRUPTION");
                },
            });
            await expect(interrupted.applyValidatedPlan({projectPath: context.projectPath, workflowId: "workflow-1"}))
                .rejects.toThrow("TEST_INTERRUPTION");
            await fs.appendFile(context.storyboardFile, "\n外部编辑。\n", "utf8");

            const recovering = new PlanningApplyService({
                client: context.client,
                clock: () => new Date("2026-07-21T02:00:00.000Z"),
                idFactory: fixedIdFactory,
            });
            await recovering.recoverProject({projectPath: context.projectPath, projectId: context.projectId});

            await expect(new PlanningApplyRepository(context.client).read("workflow-1"))
                .resolves.toMatchObject({state: "apply_conflict"});
            await expect(context.client.illustrationPlanningWorkflow.findUniqueOrThrow({where: {id: "workflow-1"}}))
                .resolves.toMatchObject({status: "stale"});
            await expect(fs.readFile(context.chapterFile, "utf8")).resolves.toContain("<text-to-image-prompt id=\"image_prompt_01\">");
        } finally {
            await disposeContext(context);
        }
    }, 20_000);

    it("preserves selection shots while a chapter replan supersedes only old chapter-plan placeholders", async () => {
        const context = await createContext();
        try {
            await new PlanningApplyService({
                client: context.client,
                clock: () => new Date("2026-07-21T02:00:00.000Z"),
                idFactory: scopedIdFactory("01"),
            }).applyValidatedPlan({projectPath: context.projectPath, workflowId: "workflow-1"});

            await createAdditionalWorkflow(context, {workflowId: "workflow-selection", operation: "plan-selection"});
            await new PlanningApplyService({
                client: context.client,
                clock: () => new Date("2026-07-21T02:01:00.000Z"),
                idFactory: scopedIdFactory("02"),
            }).applyValidatedPlan({projectPath: context.projectPath, workflowId: "workflow-selection"});

            await createAdditionalWorkflow(context, {workflowId: "workflow-replan", operation: "plan-chapter"});
            await new PlanningApplyService({
                client: context.client,
                clock: () => new Date("2026-07-21T02:02:00.000Z"),
                idFactory: scopedIdFactory("03"),
            }).applyValidatedPlan({projectPath: context.projectPath, workflowId: "workflow-replan"});

            const storyboard = parseChapterStoryboardMarkdown(await fs.readFile(context.storyboardFile, "utf8")).storyboard;
            expect(storyboard.planningSources.map((source) => [source.planningRunId, source.state])).toEqual([
                ["workflow-1", "superseded"],
                ["workflow-selection", "active"],
                ["workflow-replan", "active"],
            ]);
            expect(storyboard.shots.map((shot) => [shot.placeholderId, shot.state, shot.origin.kind])).toEqual([
                ["image_prompt_01", "superseded", "chapter-plan"],
                ["image_prompt_02", "active", "selection"],
                ["image_prompt_03", "active", "chapter-plan"],
            ]);
            const chapter = await fs.readFile(context.chapterFile, "utf8");
            expect(chapter).not.toContain("id=\"image_prompt_01\"");
            expect(chapter).toContain("id=\"image_prompt_02\"");
            expect(chapter).toContain("id=\"image_prompt_03\"");
        } finally {
            await disposeContext(context);
        }
    }, 60_000);
});

type TestContext = {
    assets: IsolatedWorkspaceAssets;
    projectPath: string;
    projectId: string;
    chapterFile: string;
    storyboardFile: string;
    client: Awaited<ReturnType<typeof textToImageProjectClient>>;
};

async function createContext(): Promise<TestContext> {
    resetProjectSessionsForTest();
    registerProjectResourceOwner(workspaceHistoryResourceOwner);
    const assets = await createIsolatedWorkspaceAssets();
    const projectPath = `workspace/planning-apply-${randomUUID()}`;
    await writeProjectManifest(resolveRuntimeWorkspaceRoot(), projectPath, {kind: "novel", title: "Planning Apply", summary: ""});
    const projectRoot = resolveProjectAbsolutePath(projectPath);
    const chapterFile = path.join(projectRoot, ...CHAPTER_PATH.split("/"));
    const storyboardFile = path.join(projectRoot, ...STORYBOARD_PATH.split("/"));
    await fs.mkdir(path.dirname(chapterFile), {recursive: true});
    await fs.writeFile(chapterFile, CHAPTER_MARKDOWN, "utf8");
    await openProjectForTest(projectPath);
    const client = await textToImageProjectClient(projectPath);
    const projectId = "project-1";
    await client.projectMetadata.update({where: {key: "projectId"}, data: {value: projectId}});
    const bundle = bundleForChapter(projectId, CHAPTER_MARKDOWN);
    const plan = planForBundle(bundle);
    await client.illustrationPlanningWorkflow.create({
        data: {
            id: "workflow-1",
            projectId,
            chapterPath: CHAPTER_PATH,
            operation: "plan_chapter",
            planningRequestHash: bundle.planningRequestHash,
            planningInputHash: bundle.planningInputHash,
            inputJson: JSON.stringify(bundle),
            status: "applying",
            validatedPlanJson: JSON.stringify(plan),
            attempts: {
                create: {
                    id: "attempt-1",
                    status: "succeeded",
                    planningEvidenceHash: H("e"),
                    finishedAt: new Date("2026-07-21T01:59:00.000Z"),
                },
            },
        },
    });
    return {assets, projectPath, projectId, chapterFile, storyboardFile, client};
}

async function disposeContext(context: TestContext): Promise<void> {
    await closeTextToImageProjectClient(context.projectPath);
    await closeProjectForTest(context.projectPath).catch(() => undefined);
    await resetWorkspaceHistoryForTest();
    resetProjectSessionsForTest();
    await context.assets.dispose();
}

async function createAdditionalWorkflow(
    context: TestContext,
    input: {workflowId: string; operation: "plan-chapter" | "plan-selection"},
): Promise<void> {
    const markdown = await fs.readFile(context.chapterFile, "utf8");
    const bundle = bundleForChapter(
        context.projectId,
        markdown,
        input.operation,
        input.workflowId === "workflow-replan" ? {reason: "重建整章镜头", nonce: "replan-03"} : null,
    );
    const plan = planForBundle(bundle);
    await context.client.illustrationPlanningWorkflow.create({
        data: {
            id: input.workflowId,
            projectId: context.projectId,
            chapterPath: CHAPTER_PATH,
            operation: input.operation === "plan-chapter" ? "plan_chapter" : "plan_selection",
            planningRequestHash: bundle.planningRequestHash,
            planningInputHash: bundle.planningInputHash,
            inputJson: JSON.stringify(bundle),
            status: "applying",
            validatedPlanJson: JSON.stringify(plan),
            attempts: {
                create: {
                    id: `attempt-${input.workflowId}`,
                    status: "succeeded",
                    planningEvidenceHash: H(input.operation === "plan-chapter" ? "c" : "b"),
                    finishedAt: new Date("2026-07-21T01:59:00.000Z"),
                },
            },
        },
    });
}

async function runApplyScenario(stopAfter: IllustrationPlanningApplyState | null) {
    const context = await createContext();
    try {
        const options = {
            client: context.client,
            clock: () => new Date("2026-07-21T02:00:00.000Z"),
            idFactory: fixedIdFactory,
        };
        const first = new PlanningApplyService({
            ...options,
            ...(stopAfter ? {
                afterStage: (state: IllustrationPlanningApplyState) => {
                    if (state === stopAfter) throw new Error("TEST_INTERRUPTION");
                },
            } : {}),
        });
        if (stopAfter) {
            await expect(first.applyValidatedPlan({projectPath: context.projectPath, workflowId: "workflow-1"}))
                .rejects.toThrow("TEST_INTERRUPTION");
            await new PlanningApplyService(options).recoverProject({projectPath: context.projectPath, projectId: context.projectId});
        } else {
            await first.applyValidatedPlan({projectPath: context.projectPath, workflowId: "workflow-1"});
        }
        const journal = await new PlanningApplyRepository(context.client).read("workflow-1");
        const workflow = await context.client.illustrationPlanningWorkflow.findUniqueOrThrow({where: {id: "workflow-1"}});
        return {
            chapter: await fs.readFile(context.chapterFile, "utf8"),
            storyboard: await fs.readFile(context.storyboardFile, "utf8"),
            workflowStatus: workflow.status,
            journalState: journal.state,
            jobCount: await context.client.textToImageJob.count(),
        };
    } finally {
        await disposeContext(context);
    }
}

function bundleForChapter(
    projectId: string,
    markdown: string,
    operation: "plan-chapter" | "plan-selection" = "plan-chapter",
    replan: {reason: string; nonce: string} | null = null,
): IllustrationPlanningInputBundle {
    const parser = new IllustrationChapterParser();
    const chapter = parser.parse({chapterPath: CHAPTER_PATH, markdown});
    const base = createIllustrationPlanningTestBundle(CHAPTER_PATH);
    const selectionBlock = chapter.anchorCandidates.find((block) => block.normalizedText.includes("少女")) ?? chapter.anchorCandidates[0]!;
    const selection = operation === "plan-selection" ? parser.select(chapter, {
        selectedText: "少女站在栏杆旁。",
        lineRange: {startLine: selectionBlock.startLine, endLine: selectionBlock.endLine},
        chapterFileHash: chapter.chapterFileHash,
    }) : null;
    const requestIdentity = {
        ...base.requestIdentity,
        projectId,
        operation,
        sourceChapterHash: chapter.sourceChapterHash,
        selectionHash: selection?.selectionHash ?? null,
        replan,
        contentBlockParserVersion: chapter.parserVersion,
    };
    const draft = {
        ...base,
        requestIdentity,
        planningRequestHash: createIllustrationPlanningRequestHash(requestIdentity),
        chapter: {
            chapterFileHash: chapter.chapterFileHash,
            sourceChapterHash: chapter.sourceChapterHash,
            blocks: chapter.anchorCandidates.map(({startLine: _startLine, endLine: _endLine, ...block}) => block),
            selection: selection ? {
                selectedText: selection.selectedText,
                selectedTextHash: selection.selectedTextHash,
                selectionHash: selection.selectionHash,
                startAnchorId: selection.startAnchorId,
                endAnchorId: selection.endAnchorId,
                insertAfterAnchorId: selection.insertAfterAnchorId,
                startBlockOffset: selection.startBlockOffset,
                endBlockOffset: selection.endBlockOffset,
                contextBefore: selection.contextBefore.map(({startLine: _startLine, endLine: _endLine, ...block}) => block),
                contextAfter: selection.contextAfter.map(({startLine: _startLine, endLine: _endLine, ...block}) => block),
            } : null,
        },
        toolContext: {...base.toolContext, contextId: projectId, operation},
        userRequest: {...base.userRequest, replan},
    };
    return {...draft, planningInputHash: createIllustrationPlanningInputHash(draft)};
}

function planForBundle(bundle: IllustrationPlanningInputBundle): ValidatedIllustrationPlan {
    const anchorId = bundle.chapter.selection?.insertAfterAnchorId ?? bundle.chapter.blocks[0]!.anchorId;
    return {
        schemaVersion: "nbook.validated-illustration-plan/v1",
        validatorVersion: ILLUSTRATION_PLAN_VALIDATOR_VERSION,
        operation: bundle.requestIdentity.operation,
        shots: [{
            purpose: "建立港口规模",
            characterIds: [],
            outfitRefs: [],
            action: {},
            composition: {
                shotSize: "wide",
                cameraAngle: "high",
                viewpoint: "third-person",
                canvasIntent: "landscape",
                subjectPlacement: "center",
            },
            continuity: {timeOfDay: "dawn", palette: "silver-blue"},
            tagPatternRefs: [],
            tagDelta: {prefer: [], avoid: []},
            anchorId,
            insertAfterAnchorId: anchorId,
            tagResolutions: {},
            shotIntentHash: H("f"),
        }],
    };
}

function fixedIdFactory(kind: "journal" | "revision" | "shot" | "placeholder", index: number): string {
    if (kind === "journal") return "apply_01";
    if (kind === "revision") return "sb_01";
    if (kind === "shot") return `shot_${String(index + 1).padStart(2, "0")}`;
    return `image_prompt_${String(index + 1).padStart(2, "0")}`;
}

function scopedIdFactory(sequence: string) {
    return (kind: "journal" | "revision" | "shot" | "placeholder", index: number): string => {
        if (kind === "journal") return `apply_${sequence}`;
        if (kind === "revision") return `sb_${sequence}`;
        if (kind === "shot") return `shot_${sequence}_${String(index + 1)}`;
        return `image_prompt_${sequence}`;
    };
}
