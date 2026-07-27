import {randomUUID} from "node:crypto";
import {mkdir, rm, stat} from "node:fs/promises";
import {join} from "node:path";
import os from "node:os";
import {consola} from "consola";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {PROJECT_DATABASE_MODULE_TOKEN} from "nbook/server/workspace-files/project-database-module";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {
    PROJECT_GRACE_MS,
    ProjectNotOpenError,
    acquireUserPresence,
    assertProjectOpen,
    closeAllProjects,
    closeProject,
    createProject,
    deleteProject,
    isProjectOpen,
    listOpenProjects,
    listProjectCandidates,
    listProjects,
    markProjectActivity,
    openProject,
    openProjectControl,
    projectOccupancy,
    registerAgentPresenceProbe,
    requireReadyModuleHandle,
    resetProjectSessionsForTest,
    sweepProjectSessions,
    updateProjectMetadata,
} from "nbook/server/workspace-files/project-session";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

describe("project-session production facade", () => {
    let tempRoot: string;
    let workspaceRoot: AbsoluteFsPath;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        tempRoot = join(os.tmpdir(), `neuro-book-project-session-test-${randomUUID()}`);
        workspaceRoot = absoluteFsPath(join(tempRoot, "workspace"));
        await mkdir(workspaceRoot, {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});
    });

    afterEach(async () => {
        await closeAllProjects().catch(() => undefined);
        resetProjectSessionsForTest();
        setWorkspaceRuntimeRootContextForTest(null);
        collectReleasedSqliteHandles({force: true});
        await removeTempRootBestEffort(tempRoot);
    }, 60_000);

    /** 在临时Workspace Root建立具备合法manifest的Project。 */
    async function createTempProject(slug: string): Promise<string> {
        const projectPath = `workspace/${slug}`;
        await writeProjectManifest(workspaceRoot, projectPath, {
            kind: "novel",
            title: slug,
            summary: "",
        });
        return projectPath;
    }

    it("并发open单飞并发布required Module typed handles", async () => {
        await expect(openProject(workspaceRoot, "workspace/does-not-exist", {kind: "user"}))
            .rejects.toMatchObject({statusCode: 404});

        const projectPath = await createTempProject("open-book");
        const [first, second] = await Promise.all([
            openProject(workspaceRoot, projectPath, {kind: "user"}),
            openProject(workspaceRoot, projectPath, {kind: "agent", sessionId: 1}),
        ]);
        const reused = await openProject(workspaceRoot, projectPath, {kind: "job", source: "test"});

        expect(first).toBe(second);
        expect(reused).toBe(first);
        expect(listOpenProjects()).toEqual([
            expect.objectContaining({
                projectPath,
                state: "open",
                userConnections: 0,
                agentActive: false,
            }),
        ]);

        const database = requireReadyModuleHandle(
            first,
            PROJECT_DATABASE_MODULE_TOKEN,
        );
        await expect(database.databasePath).resolves.toBe(
            absoluteFsPath(join(first.workspace.root, ".nbook", "project.sqlite")),
        );
        expect((await stat(join(workspaceRoot, "open-book", ".nbook", "project.sqlite"))).isFile()).toBe(true);
    });

    it("唯一控制面Lifecycle贯穿candidates、create、open、metadata与显式close后delete", async () => {
        await mkdir(join(workspaceRoot, "candidate-book"));
        await expect(listProjectCandidates()).resolves.toEqual(expect.objectContaining({
            candidates: [projectWorkspaceRef("candidate-book")],
        }));

        const ref = projectWorkspaceRef("control-book");
        const created = await createProject({ref, title: "Control Book", summary: "Before"});
        expect(created.project).toMatchObject({
            projectRoot: "control-book",
            kind: "novel",
            title: "Control Book",
            summary: "Before",
        });
        await expect(listProjects()).resolves.toEqual(expect.objectContaining({
            projects: [expect.objectContaining({projectRoot: "control-book"})],
        }));

        const opened = await openProjectControl(ref, {kind: "user"});
        expect(opened.publication).toMatchObject({
            change: "none",
            project: {projectRoot: "control-book", title: "Control Book"},
        });
        const updated = await updateProjectMetadata({ref, title: "Updated Book", summary: "After"});
        expect(updated.project).toMatchObject({title: "Updated Book", summary: "After"});

        await expect(deleteProject(ref)).rejects.toMatchObject({code: "PROJECT_IN_USE"});
        expect(isProjectOpen("workspace/control-book")).toBe(true);
        await closeProject("workspace/control-book", "delete");
        await expect(deleteProject(ref)).resolves.toMatchObject({projectRoot: "control-book"});
        await expect(listProjects()).resolves.toEqual(expect.objectContaining({projects: []}));
    }, 60_000);

    it("用户presence归零进入grace，重连恢复且release幂等", async () => {
        expect(() => acquireUserPresence("workspace/never-open")).toThrow(ProjectNotOpenError);
        const projectPath = await createTempProject("presence-book");
        await openProject(workspaceRoot, projectPath, {kind: "user"});

        const releaseFirst = acquireUserPresence(projectPath);
        const releaseSecond = acquireUserPresence(projectPath);
        expect(projectOccupancy(projectPath)).toEqual({
            state: "open",
            userConnections: 2,
            agentActive: false,
        });

        releaseFirst();
        releaseFirst();
        expect(projectOccupancy(projectPath)?.userConnections).toBe(1);
        releaseSecond();
        expect(projectOccupancy(projectPath)?.state).toBe("grace");
        expect(() => assertProjectOpen(projectPath)).not.toThrow();

        const releaseReconnected = acquireUserPresence(projectPath);
        expect(projectOccupancy(projectPath)).toEqual({
            state: "open",
            userConnections: 1,
            agentActive: false,
        });
        releaseReconnected();
    });

    it("Agent在场阻止grace，离场后到期关闭当前generation", async () => {
        const projectPath = await createTempProject("agent-book");
        const ready = await openProject(workspaceRoot, projectPath, {kind: "agent", sessionId: 7});
        let agentRunning = true;
        registerAgentPresenceProbe((candidate) => candidate === ready && agentRunning);

        acquireUserPresence(projectPath)();
        const base = Date.now();
        await expect(sweepProjectSessions(base)).resolves.toEqual([]);
        expect(projectOccupancy(projectPath)).toEqual({
            state: "open",
            userConnections: 0,
            agentActive: true,
        });

        agentRunning = false;
        await expect(sweepProjectSessions(base)).resolves.toEqual([]);
        expect(projectOccupancy(projectPath)?.state).toBe("grace");
        await expect(sweepProjectSessions(base + PROJECT_GRACE_MS + 1)).resolves.toEqual([projectPath]);
        expect(isProjectOpen(projectPath)).toBe(false);
    });

    it("旧generation的Agent presence不会占用close/reopen后的新generation", async () => {
        const projectPath = await createTempProject("agent-generation-book");
        const staleReady = await openProject(workspaceRoot, projectPath, {kind: "agent", sessionId: 8});
        registerAgentPresenceProbe((candidate) => candidate === staleReady);

        expect(projectOccupancy(projectPath)?.agentActive).toBe(true);
        await closeProject(projectPath, "shutdown");
        const currentReady = await openProject(workspaceRoot, projectPath, {kind: "job", source: "presence-reopen-test"});

        expect(currentReady.generation).not.toBe(staleReady.generation);
        expect(projectOccupancy(projectPath)?.agentActive).toBe(false);
    });

    it("旧generation迟到release不会扣减重开后的presence", async () => {
        const projectPath = await createTempProject("generation-book");
        await openProject(workspaceRoot, projectPath, {kind: "user"});
        const staleRelease = acquireUserPresence(projectPath);

        await closeProject(projectPath, "shutdown");
        await openProject(workspaceRoot, projectPath, {kind: "user"});
        const currentRelease = acquireUserPresence(projectPath);
        staleRelease();

        expect(projectOccupancy(projectPath)).toEqual({
            state: "open",
            userConnections: 1,
            agentActive: false,
        });
        currentRelease();
    });

    it("grace-expired close会复检状态，open generation保持可用", async () => {
        const projectPath = await createTempProject("recheck-book");
        await openProject(workspaceRoot, projectPath, {kind: "user"});

        await closeProject(projectPath, "grace-expired");

        expect(isProjectOpen(projectPath)).toBe(true);
        expect(projectOccupancy(projectPath)?.state).toBe("open");
    });

    it("activity只刷新ready generation，closeAll完成后数据面立即拒绝", async () => {
        markProjectActivity("workspace/never-open");
        expect(listOpenProjects()).toEqual([]);

        const projectPath = await createTempProject("shutdown-book");
        await openProject(workspaceRoot, projectPath, {kind: "user"});
        const before = listOpenProjects()[0];
        await new Promise((resolve) => setTimeout(resolve, 15));
        markProjectActivity(projectPath);
        const after = listOpenProjects()[0];
        expect(after && before && after.lastActivityAt > before.lastActivityAt).toBe(true);

        await closeAllProjects();

        expect(listOpenProjects()).toEqual([]);
        expect(isProjectOpen(projectPath)).toBe(false);
        expect(() => assertProjectOpen(projectPath)).toThrow(ProjectNotOpenError);
    });
});

/** Windows下libSQL句柄释放可能稍有延迟，测试清理允许系统级短暂占用。 */
async function removeTempRootBestEffort(target: string): Promise<void> {
    try {
        collectReleasedSqliteHandles({force: true});
        await rm(target, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error
            && (error.code === "EBUSY" || error.code === "EPERM" || error.code === "ENOTEMPTY")) {
            consola.warn({target, error}, "清理临时Project目录失败，忽略");
            return;
        }
        throw error;
    }
}
