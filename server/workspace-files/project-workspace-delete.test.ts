import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import os from "node:os";
import {consola} from "consola";
import {describe, expect, it, vi} from "vitest";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {PROJECT_AGENT_SQL_MODULE_TOKEN} from "nbook/server/agent/tools/agent-sql-project-module";
import {PROJECT_PLOT_WORLD_MODULE_TOKEN} from "nbook/server/plot";
import {listNovels} from "nbook/server/utils/novel-chapter";
import {
    isProjectRootDeleted,
    writeProjectManifest as writeProjectManifestAtRoot,
} from "nbook/server/workspace-files/project-workspace";
import {deleteProjectWorkspace as deleteProjectWorkspaceAtRoot} from "nbook/server/workspace-files/project-workspace-delete";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {
    activateReadyProjectModule,
    requireReadyModuleHandle,
    requireReadyProjectPath,
} from "nbook/server/workspace-files/project-session";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {PROJECT_FILE_INDEX_MODULE_TOKEN} from "nbook/server/workspace-files/project-file-index";

/** 测试Adapter：按当前隔离cwd解析一次Runtime Workspace Root。 */
function resolveProjectAbsolutePath(projectPath: string) {
    return resolveProjectWorkspaceRoot(resolveRuntimeWorkspaceRoot(), normalizeProjectPath(projectPath));
}

async function writeProjectManifest(projectPath: string, manifest: Parameters<typeof writeProjectManifestAtRoot>[2]) {
    return writeProjectManifestAtRoot(resolveRuntimeWorkspaceRoot(), projectPath, manifest);
}

async function deleteProjectWorkspace(projectPath: string, options?: Parameters<typeof deleteProjectWorkspaceAtRoot>[2]) {
    return deleteProjectWorkspaceAtRoot(resolveRuntimeWorkspaceRoot(), projectPath, options);
}

describe("deleteProjectWorkspace", () => {
    it("删除前由ProjectSession关闭Plot/World、Agent SQL与File Index generation资源", async () => {
        const projectPath = `workspace/delete-project-${randomUUID()}`;
        const projectRoot = resolveProjectAbsolutePath(projectPath);
        try {
            await writeProjectManifest(projectPath, {
                kind: "novel",
                title: "Delete Project",
                summary: "",
            });
            await mkdir(join(projectRoot, "manuscript"), {recursive: true});
            await mkdir(join(projectRoot, "world-engine", "schema"), {recursive: true});
            await writeFile(join(projectRoot, "manuscript", "chapter-1.md"), "# Chapter 1\n", "utf8");
            await writeFile(join(projectRoot, "world-engine", "schema", "index.ts"), [
                'import {z} from "zod";',
                "",
                "export const WorldSchema = {",
                "    world: z.object({",
                "        note: z.string().optional().describe('备注'),",
                "    }),",
                "} as const;",
                "",
            ].join("\n"), "utf8");
            await writeFile(join(projectRoot, "world-engine", "calendar.ts"), [
                "export default {",
                "    type: 'simple',",
                "    eraBefore: '复兴纪元',",
                "    eraAfter: '复兴纪元',",
                "    baseUnit: 'second',",
                "    units: [{name: 'day', parent: 'second', ratio: 86400}],",
                "    format: '{eraName}{day}日 {second}',",
                "};",
                "",
            ].join("\n"), "utf8");
            await openProjectForTest(projectPath);

            const ready = requireReadyProjectPath(projectPath);
            const {plot: plotFacade, world: worldEngineFacade} = await activateReadyProjectModule(
                ready,
                PROJECT_PLOT_WORLD_MODULE_TOKEN,
            );
            await plotFacade.getStoryDto();
            await worldEngineFacade.createSubject({id: "world", type: "world", name: "世界", at: 0n});
            await worldEngineFacade.writeSlice({
                instant: 10n,
                title: "打开 World Engine client",
                patches: [{subjectId: "world", path: "/note", op: "replace", value: "delete me"}],
            });
            const sql = await activateReadyProjectModule(
                ready,
                PROJECT_AGENT_SQL_MODULE_TOKEN,
            );
            await sql.schemaSummary();
            await requireReadyModuleHandle(
                ready,
                PROJECT_FILE_INDEX_MODULE_TOKEN,
            ).read();

            await deleteProjectWorkspace(projectPath, {
                archiveProjectSessions: async () => undefined,
            });

            await expect(projectRootDeleted(projectRoot)).resolves.toBe(true);
        } finally {
            await closeProjectForTest(projectPath).catch(() => undefined);
            await removePathBestEffort(projectRoot);
        }
    }, 20_000);

    it("归档 Agent sessions 失败时仍完成 Project Workspace 删除", async () => {
        const originalCwd = process.cwd();
        const root = join(os.tmpdir(), "neuro-book-delete-project-archive-fail-test", randomUUID());
        const projectPath = "workspace/archive-fails-book";
        const projectRoot = join(root, "workspace", "archive-fails-book");
        const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
        try {
            await mkdir(join(root, "assets", "workspace", ".nbook"), {recursive: true});
            process.chdir(root);
            await writeProjectManifest(projectPath, {
                kind: "novel",
                title: "Archive Fails Book",
                summary: "",
            });

            await expect(deleteProjectWorkspace(projectPath, {
                archiveProjectSessions: async () => {
                    throw new Error("archive failed");
                },
            })).resolves.toBeUndefined();

            await expect(projectRootDeleted(projectRoot)).resolves.toBe(true);
            expect(warnSpy).toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
            process.chdir(originalCwd);
            await removePathBestEffort(root);
        }
    }, 20_000);

    it("删除 Project Workspace 时归档绑定到同 projectPath 的 Agent sessions", async () => {
        const originalCwd = process.cwd();
        const root = join(os.tmpdir(), "neuro-book-delete-project-session-test", randomUUID());
        const projectPath = "workspace/same-name-book";
        const projectRoot = join(root, "workspace", "same-name-book");
        try {
            await mkdir(join(root, "assets", "workspace", ".nbook"), {recursive: true});
            process.chdir(root);
            await writeProjectManifest(projectPath, {
                kind: "novel",
                title: "Same Name Book",
                summary: "old",
            });
            const repo = new JsonlSessionRepository(join(root, "workspace"));
            const harness = new NeuroAgentHarness({repo});
            const active = await repo.createSession({
                profileKey: "leader.default",
                initial: {},
                workspaceRoot: "workspace",
                workspaceKey: "global",
                projectPath,
                title: "旧书会话",
            });
            const activeBeforeDeleteEntry = await repo.appendUserMessage(active.metadata.sessionId, "delete me", active.metadata.workspaceKey);
            const system = await repo.createSession({
                profileKey: "summarizer",
                initial: {},
                workspaceRoot: "workspace",
                workspaceKey: "global",
                projectPath,
                systemRole: "summarizer",
            });
            const archived = await repo.createSession({
                profileKey: "leader.default",
                initial: {},
                workspaceRoot: "workspace",
                workspaceKey: "global",
                projectPath,
            });
            await repo.appendEntry(archived.metadata.sessionId, {
                type: "session_archived",
                reason: "already.archived",
            });

            await deleteProjectWorkspace(projectPath, {
                archiveProjectSessions: async (targetProjectPath, reason) => {
                    await expect(projectRootDeleted(projectRoot)).resolves.toBe(true);
                    return harness.archiveSessionsByProjectPath(targetProjectPath, reason);
                },
            });
            await writeProjectManifest(projectPath, {
                kind: "novel",
                title: "Same Name Book",
                summary: "new",
            });
            await repo.moveLeaf(active.metadata.sessionId, activeBeforeDeleteEntry.id, active.metadata.workspaceKey);

            const [novel] = await listNovels();
            const visibleSessions = await repo.listSessions({projectPath, includeArchived: false, includeSystem: false, status: "active"});
            const allSessions = await repo.listSessions({projectPath, includeArchived: true, includeSystem: true, status: "all"});

            expect(novel).toMatchObject({
                id: projectPath,
                summary: "new",
            });
            expect(visibleSessions).toHaveLength(0);
            expect(allSessions).toHaveLength(3);
            expect(allSessions.every((session) => session.archived)).toBe(true);
            expect(repo.summary(await repo.readSession(active.metadata.sessionId)).archived).toBe(true);
            await expect(countArchivedEntries(repo, active.metadata.sessionId)).resolves.toBe(1);
            await expect(countArchivedEntries(repo, system.metadata.sessionId)).resolves.toBe(1);
            await expect(countArchivedEntries(repo, archived.metadata.sessionId)).resolves.toBe(1);
        } finally {
            process.chdir(originalCwd);
            await removePathBestEffort(root);
        }
    }, 20_000);
});

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

async function projectRootDeleted(projectRoot: string): Promise<boolean> {
    if (!(await pathExists(projectRoot))) {
        return true;
    }
    return isProjectRootDeleted(projectRoot);
}

async function removePathBestEffort(filePath: string): Promise<void> {
    try {
        await rm(filePath, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error) {
            if (error.code === "EBUSY" || error.code === "EPERM" || error.code === "ENOTEMPTY") {
                return;
            }
        }
        throw error;
    }
}

async function countArchivedEntries(repo: JsonlSessionRepository, sessionId: number): Promise<number> {
    const text = await readFile(join(repo.rootWorkspace, ".nbook", "agent", "sessions", `${sessionId}.jsonl`), "utf8");
    return text.split(/\r?\n/u).filter((line) => line.includes('"type":"session_archived"')).length;
}
