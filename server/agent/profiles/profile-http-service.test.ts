import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {Type} from "typebox";
import {afterEach, describe, expect, it} from "vitest";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {HistorySet, Message, ProfilePrompt, WorkflowCatalog as WorkflowCatalogPrompt} from "nbook/server/agent/profiles/profile-dsl";
import {previewAgentProfilePrepare} from "nbook/server/agent/profiles/profile-http-service";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {WorkflowCatalog} from "nbook/server/agent/workflow/workflow-catalog";
import {resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";

const roots: string[] = [];
const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;

afterEach(async () => {
    await closeProjectForTest("workspace/project").catch(() => undefined);
    resetProjectSessionsForTest();
    restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
    restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Profile prepare preview物理Workspace Root", () => {
    it("Project与user-assets session使用各自真实物理root", async () => {
        const fixture = await fixtureRoot();
        const applicationRoot = absoluteFsPath(path.join(fixture, "application"));
        const stateRoot = absoluteFsPath(path.join(fixture, "state"));
        const runtimePaths = createRuntimePaths({applicationRoot, stateRoot});
        const projectRoot = absoluteFsPath(path.join(runtimePaths.workspaceRoot, "project"));
        await Promise.all([
            mkdir(applicationRoot, {recursive: true}),
            mkdir(runtimePaths.workspaceRoot, {recursive: true}),
            mkdir(projectRoot, {recursive: true}),
        ]);
        await writeProjectManifest(projectRoot);
        process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        await openProjectForTest("workspace/project");

        const repo = new JsonlSessionRepository(runtimePaths.workspaceRoot);
        const harness = new NeuroAgentHarness({
            runtimePaths,
            repo,
            profiles: new AgentProfileCatalog(
                path.join(fixture, "missing-system-profiles"),
                path.join(fixture, "missing-user-profiles"),
            ),
            enableSessionSummarizer: false,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.preview-path", name: "Preview Path"},
            initialSchema: Type.Object({}),
            tools: {},
            prepare({session}) {
                return {
                    systemPrompt: JSON.stringify({
                        workspaceRoot: session.workspaceRoot,
                        workspaceFsRoot: session.workspaceFsRoot,
                    }),
                };
            },
        }), false);

        try {
            const project = await repo.createSession({
                profileKey: "test.preview-path",
                initial: {},
                workspaceRoot: "workspace",
                workspaceKey: "managed",
                projectPath: "workspace/project",
            });
            const userAssets = await repo.createSession({
                profileKey: "test.preview-path",
                initial: {},
                workspaceRoot: "workspace/.nbook",
                workspaceKey: "user-assets",
            });
            await expectPreviewRoot(harness, project.metadata.sessionId, "workspace", runtimePaths.workspaceRoot);
            await expectPreviewRoot(harness, userAssets.metadata.sessionId, "workspace/.nbook", runtimePaths.userNbookRoot);
        } finally {
            await harness.dispose();
        }
    });

    it("Project-bound Profile prompt 看到同一 Project Workspace 的 workflow catalog", async () => {
        const fixture = await fixtureRoot();
        const applicationRoot = absoluteFsPath(path.join(fixture, "application"));
        const stateRoot = absoluteFsPath(path.join(fixture, "state"));
        const runtimePaths = createRuntimePaths({applicationRoot, stateRoot});
        const projectRoot = absoluteFsPath(path.join(runtimePaths.workspaceRoot, "project"));
        const workflowRoot = path.join(projectRoot, ".nbook", "agent", "workflows", "brainstorm-opening");
        await Promise.all([
            mkdir(applicationRoot, {recursive: true}),
            mkdir(runtimePaths.workspaceRoot, {recursive: true}),
            mkdir(workflowRoot, {recursive: true}),
        ]);
        await writeProjectManifest(projectRoot);
        await writeFile(path.join(workflowRoot, "workflow.ts"), `
            export default {
                key: "brainstorm-opening",
                title: "项目开篇脑暴",
                description: "项目专用脑暴 workflow",
                whenToUse: "项目开篇需要多个角度时",
                run: async () => ({ok: true}),
            };
        `, "utf8");
        process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        await openProjectForTest("workspace/project");

        const repo = new JsonlSessionRepository(runtimePaths.workspaceRoot);
        const harness = new NeuroAgentHarness({
            runtimePaths,
            repo,
            profiles: new AgentProfileCatalog(
                path.join(fixture, "missing-system-profiles"),
                path.join(fixture, "missing-user-profiles"),
            ),
            workflows: new WorkflowCatalog(
                path.join(fixture, "missing-system-workflows"),
                path.join(fixture, "missing-user-workflows"),
            ),
            enableSessionSummarizer: false,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.project-workflow-prompt", name: "Project Workflow Prompt"},
            initialSchema: Type.Object({}),
            tools: {},
            context() {
                return ProfilePrompt({
                    children: HistorySet({
                        children: Message({children: WorkflowCatalogPrompt({})}),
                    }),
                });
            },
        }), false);

        try {
            const session = await repo.createSession({
                profileKey: "test.project-workflow-prompt",
                initial: {},
                workspaceRoot: "workspace",
                workspaceKey: "managed",
                projectPath: "workspace/project",
            });
            const preview = await previewAgentProfilePrepare(harness, {
                profileKey: "test.project-workflow-prompt",
                sessionId: String(session.metadata.sessionId),
            });
            expect(preview.ok).toBe(true);
            const text = preview.messages.map((message) => message.text).join("\n");
            expect(text).toContain("brainstorm-opening");
            expect(text).toContain("项目开篇脑暴");
            expect(text).toContain("项目专用脑暴 workflow");
        } finally {
            await harness.dispose();
        }
    });
});

/** 断言prepare preview看到的逻辑引用与物理root。 */
async function expectPreviewRoot(
    harness: NeuroAgentHarness,
    sessionId: number,
    expectedRef: string,
    expectedFsRoot: string,
): Promise<void> {
    const preview = await previewAgentProfilePrepare(harness, {
        profileKey: "test.preview-path",
        sessionId: String(sessionId),
    });
    expect(preview.ok).toBe(true);
    const systemPrompt = preview.messages.find((message) => message.role === "systemPrompt");
    expect(JSON.parse(systemPrompt?.text ?? "null")).toEqual({
        workspaceRoot: expectedRef,
        workspaceFsRoot: expectedFsRoot,
    });
}

/** 创建隔离Runtime fixture。 */
async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "nbook-profile-preview-path-"));
    roots.push(root);
    return root;
}

/** 写入Lifecycle open所需的最小Project manifest。 */
async function writeProjectManifest(projectRoot: string): Promise<void> {
    await writeFile(path.join(projectRoot, "project.yaml"), [
        "kind: novel",
        "title: Profile Preview Project",
        "summary: ''",
        "",
    ].join("\n"), "utf8");
}

/** 恢复单个运行时环境变量。 */
function restoreEnv(name: "NEURO_BOOK_APPLICATION_ROOT" | "NEURO_BOOK_STATE_ROOT", value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}
