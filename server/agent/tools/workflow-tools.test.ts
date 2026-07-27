import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {WorkflowCatalog} from "nbook/server/agent/workflow/workflow-catalog";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

describe("run_workflow cancellation propagation", () => {
    afterEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
    });

    it("wait:true 将父 invocation signal 传给 Workflow Run", async () => {
        const controller = new AbortController();
        let cancelRun: (() => void) | undefined;
        let resolveDone: ((view: {runId: string; workflowKey: string; status: "cancelled"; result?: null; error?: string; pendingAsks: []; logs: []; progress: null; journal: []}) => void) | undefined;
        const done = new Promise<{runId: string; workflowKey: string; status: "cancelled"; result?: null; error?: string; pendingAsks: []; logs: []; progress: null; journal: []}>((resolve) => {
            resolveDone = resolve;
        });
        const startWorkflowRun = vi.fn((input: {signal?: AbortSignal}) => {
            cancelRun = () => resolveDone!({
                runId: "run_cancelled",
                workflowKey: "signal-workflow",
                status: "cancelled",
                result: null,
                error: "workflow run 被取消",
                pendingAsks: [],
                logs: [],
                progress: null,
                journal: [],
            });
            input.signal?.addEventListener("abort", () => cancelRun?.(), {once: true});
            return {runId: "run_cancelled", done};
        });

        vi.doMock("nbook/server/agent/workflow/workflow-demo-service", () => ({
            useWorkflowDemoService: () => ({
                startWorkflowRun,
                runSummary: vi.fn(async () => ({
                    sessions: [],
                    usage: {
                        inputTokens: 0,
                        outputTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                        totalTokens: 0,
                        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                    },
                })),
                runState: vi.fn(async () => ({machineMermaid: null})),
            }),
        }));
        const workspaceRoot = absoluteFsPath(process.cwd());
        const ready = readyProject(workspaceRoot, absoluteFsPath(join(workspaceRoot, ".agent", "workflow-tools-signal-project")));
        const targetMocks = mockWorkflowProject(ready, workspaceRoot);

        const {createWorkflowTools} = await import("nbook/server/agent/tools/workflow-tools");
        const context = {
            harness: {
                repo: {rootWorkspace: workspaceRoot},
                configTargetForInvocation: targetMocks.configTargetForInvocation,
                workflows: {
                    get: vi.fn(async () => ({
                        def: {
                            key: "signal-workflow",
                            run: async () => null,
                        },
                    })),
                },
            },
            sessionId: 1,
            profileKey: "leader",
            workspaceRootRef: "workspace",
            workspaceFsRoot: workspaceRoot,
            workspaceKey: "global",
            projectPath: "workspace/project",
            invocationId: "workflow-signal-invocation",
        } as unknown as ToolExecutionContext;
        const tool = createWorkflowTools().runWorkflow.runtime();

        const pending = tool.executeWithContext!(context, "tool-workflow-signal", {workflowKey: "signal-workflow", wait: true}, undefined, controller.signal);
        await vi.waitFor(() => expect(startWorkflowRun).toHaveBeenCalledOnce());
        expect(startWorkflowRun).toHaveBeenCalledWith(expect.objectContaining({
            signal: controller.signal,
            config: targetMocks.config,
            project: ready,
        }));
        expect(targetMocks.configTargetForInvocation).toHaveBeenCalledWith("workflow-signal-invocation");
        expect(targetMocks.loadEffectiveConfigFromTarget).toHaveBeenCalledWith({
            scope: "project",
            workspaceRoot,
            project: ready,
        });

        controller.abort(new Error("parent cancelled"));
        const result = await pending;
        expect(result.details).toEqual(expect.objectContaining({runId: "run_cancelled", status: "cancelled"}));
    });

    it("list_workflows 使用当前 Project Workspace 的三层 catalog", async () => {
        const root = await mkdtemp(join(process.cwd(), ".agent", "workflow-tools-catalog-"));
        try {
            const systemRoot = join(root, "system");
            const userRoot = join(root, "user");
            const projectRoot = join(root, "project");
            await mkdir(join(projectRoot, ".nbook", "agent", "workflows", "brainstorm-opening"), {recursive: true});
            await writeFile(join(projectRoot, ".nbook", "agent", "workflows", "brainstorm-opening", "workflow.ts"), [
                "export default { title: '项目开篇脑暴', run: async () => null };",
            ].join("\n"), "utf8");

            const workspaceRoot = absoluteFsPath(root);
            const ready = readyProject(workspaceRoot, absoluteFsPath(projectRoot));
            const targetMocks = mockWorkflowProject(ready, workspaceRoot);
            vi.doMock("nbook/server/agent/harness/agent-visible-models", () => ({
                resolveAgentVisibleModels: vi.fn(() => []),
            }));

            const {createWorkflowTools} = await import("nbook/server/agent/tools/workflow-tools");
            const tool = createWorkflowTools().listWorkflows.runtime();
            const catalog = new WorkflowCatalog(systemRoot, userRoot);
            const listWorkflows = vi.spyOn(catalog, "list");
            const context = {
                harness: {
                    repo: {rootWorkspace: workspaceRoot},
                    configTargetForInvocation: targetMocks.configTargetForInvocation,
                    workflows: catalog,
                },
                sessionId: 1,
                profileKey: "leader",
                workspaceRootRef: "workspace",
                workspaceFsRoot: workspaceRoot,
                workspaceKey: "global",
                projectPath: "workspace/project",
                invocationId: "workflow-list-invocation",
            } as unknown as ToolExecutionContext;

            const result = await tool.executeWithContext!(context, "tool-catalog", {});

            expect(result.details).toEqual(expect.objectContaining({
                workflows: [expect.objectContaining({key: "brainstorm-opening", source: "project"})],
            }));
            expect(targetMocks.configTargetForInvocation).toHaveBeenCalledWith("workflow-list-invocation");
            expect(listWorkflows).toHaveBeenCalledWith(ready.workspace);
            expect(targetMocks.loadEffectiveConfigFromTarget).toHaveBeenCalledWith({
                scope: "project",
                workspaceRoot,
                project: ready,
            });
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("run_workflow 使用同一个 Project Workspace Catalog 解析项目 workflow", async () => {
        const root = await mkdtemp(join(process.cwd(), ".agent", "workflow-tools-run-catalog-"));
        try {
            const systemRoot = join(root, "system");
            const userRoot = join(root, "user");
            const projectRoot = join(root, "project");
            await mkdir(join(projectRoot, ".nbook", "agent", "workflows", "brainstorm-opening"), {recursive: true});
            await writeFile(join(projectRoot, ".nbook", "agent", "workflows", "brainstorm-opening", "workflow.ts"), [
                "export default { title: '项目开篇脑暴', run: async () => ({ source: 'project' }) };",
            ].join("\n"), "utf8");

            const completed = {
                runId: "run_project_catalog",
                workflowKey: "brainstorm-opening",
                status: "completed" as const,
                result: {source: "project"},
                pendingAsks: [],
                logs: [],
                progress: null,
                journal: [],
            };
            const startWorkflowRun = vi.fn(() => ({runId: completed.runId, done: Promise.resolve(completed)}));
            const workspaceRoot = absoluteFsPath(root);
            const ready = readyProject(workspaceRoot, absoluteFsPath(projectRoot));
            const targetMocks = mockWorkflowProject(ready, workspaceRoot);
            vi.doMock("nbook/server/agent/harness/agent-visible-models", () => ({
                resolveAgentVisibleModels: vi.fn(() => []),
            }));
            vi.doMock("nbook/server/agent/workflow/workflow-demo-service", () => ({
                useWorkflowDemoService: () => ({
                    startWorkflowRun,
                    runSummary: vi.fn(async () => ({sessions: [], usage: {
                        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
                        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                    }})),
                    runState: vi.fn(async () => ({machineMermaid: null})),
                }),
            }));

            const {createWorkflowTools} = await import("nbook/server/agent/tools/workflow-tools");
            const catalog = new WorkflowCatalog(systemRoot, userRoot);
            const getWorkflow = vi.spyOn(catalog, "get");
            const context = {
                harness: {
                    repo: {rootWorkspace: workspaceRoot},
                    configTargetForInvocation: targetMocks.configTargetForInvocation,
                    workflows: catalog,
                    jobs: {spawn: vi.fn()},
                },
                sessionId: 1,
                profileKey: "leader",
                workspaceRootRef: "workspace",
                workspaceFsRoot: workspaceRoot,
                workspaceKey: "global",
                projectPath: "workspace/project",
                invocationId: "workflow-run-invocation",
            } as unknown as ToolExecutionContext;
            const tool = createWorkflowTools().runWorkflow.runtime();

            const result = await tool.executeWithContext!(context, "tool-project-run", {workflowKey: "brainstorm-opening", wait: true}, undefined, undefined);

            expect(startWorkflowRun).toHaveBeenCalledWith(expect.objectContaining({
                def: expect.objectContaining({key: "brainstorm-opening", title: "项目开篇脑暴"}),
                workspace: expect.any(Object),
                config: targetMocks.config,
                project: ready,
            }));
            expect(targetMocks.configTargetForInvocation).toHaveBeenCalledWith("workflow-run-invocation");
            expect(getWorkflow).toHaveBeenCalledWith("brainstorm-opening", ready.workspace);
            expect(targetMocks.loadEffectiveConfigFromTarget).toHaveBeenCalledWith({
                scope: "project",
                workspaceRoot,
                project: ready,
            });
            expect(result.details).toEqual(expect.objectContaining({runId: completed.runId, status: "completed", result: {source: "project"}}));
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});

/** 构造工具入口捕获的 ProjectSession generation。 */
function readyProject(
    workspaceRoot: ReturnType<typeof absoluteFsPath>,
    projectRoot: ReturnType<typeof absoluteFsPath>,
): ReadyProjectSessionRef {
    const ref = projectWorkspaceRef("project");
    return {
        workspace: resolvedProjectWorkspace(
            ref,
            projectRoot,
            createProjectWorkspaceKey(workspaceRoot, ref),
        ),
        generation: 1,
    };
}

/** 注入 invocation admission 捕获的结构化 Config target。 */
function mockWorkflowProject(
    ready: ReadyProjectSessionRef,
    workspaceRoot: ReturnType<typeof absoluteFsPath>,
) {
    const configTargetForInvocation = vi.fn(() => ({
        scope: "project" as const,
        workspaceRoot,
        project: ready,
    }));
    const config = {};
    const loadEffectiveConfigFromTarget = vi.fn(async () => config);
    vi.doMock("nbook/server/config/config-service", () => ({loadEffectiveConfigFromTarget}));
    return {configTargetForInvocation, loadEffectiveConfigFromTarget, config};
}
