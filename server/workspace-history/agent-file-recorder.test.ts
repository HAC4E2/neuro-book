import {randomUUID} from "node:crypto";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";
import os from "node:os";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    closeAllProjects,
    requireReadyModuleHandle,
    requireReadyProjectPath,
    resetProjectSessionsForTest,
} from "nbook/server/workspace-files/project-session";
import {
    closeProjectForTest,
    openProjectForTest,
} from "nbook/server/workspace-files/project-session-test-utils";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {createFileScope, resolveFileAddress} from "nbook/server/workspace-files/file-scope";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-path";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {
    PROJECT_FILE_INDEX_MODULE_TOKEN,
    setProjectFileIndexCommitHookForTest,
} from "nbook/server/workspace-files/project-file-index";
import {
    captureAgentWorkspaceWrite,
    recordAgentWorkspaceWrite,
} from "nbook/server/workspace-history/agent-file-recorder";
import {
    PROJECT_HISTORY_MODULE_TOKEN,
    resetWorkspaceHistoryForTest,
    setHistoryEnabledOverrideForTest,
} from "nbook/server/workspace-history/project-history";

describe("recordAgentWorkspaceWrite 归因记账", () => {
    let tempRoot: string;
    let workspaceRoot: AbsoluteFsPath;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        setHistoryEnabledOverrideForTest(true);
        tempRoot = join(os.tmpdir(), `neuro-book-agent-recorder-test-${randomUUID()}`);
        workspaceRoot = absoluteFsPath(join(tempRoot, "workspace"));
        await mkdir(workspaceRoot, {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});
    });

    afterEach(async () => {
        await closeAllProjects().catch(() => undefined);
        await resetWorkspaceHistoryForTest();
        resetProjectSessionsForTest();
        setWorkspaceRuntimeRootContextForTest(null);
        setHistoryEnabledOverrideForTest(null);
        setProjectFileIndexCommitHookForTest(null);
        collectReleasedSqliteHandles({force: true});
        await rm(tempRoot, {recursive: true, force: true}).catch(() => undefined);
    }, 60_000);

    it("写入归因 agent + String(sessionId)，删除记 before 快照，未 open 项目静默跳过", async () => {
        const projectPath = normalizeProjectPath("workspace/attribution");
        await writeProjectManifest(workspaceRoot, projectPath, {kind: "novel", title: "attribution", summary: ""});
        await openProjectForTest(projectPath);
        const ready = requireReadyProjectPath(projectPath);

        const scope = createFileScope({kind: "managed-project", workspaceRoot, projectPath});
        const address = resolveFileAddress(scope, "manuscript/ch1.md");
        expect(captureAgentWorkspaceWrite(address, undefined)).toBeNull();
        const historyHandle = requireReadyModuleHandle(ready, PROJECT_HISTORY_MODULE_TOKEN);
        const fileIndex = requireReadyModuleHandle(ready, PROJECT_FILE_INDEX_MODULE_TOKEN);
        await fileIndex.read();
        let indexCommitCount = 0;
        setProjectFileIndexCommitHookForTest(() => {
            indexCommitCount += 1;
        });
        const createCapture = captureAgentWorkspaceWrite(address, ready);
        expect(createCapture).toEqual(expect.objectContaining({
            history: historyHandle,
            fileIndex,
        }));
        await recordAgentWorkspaceWrite({
            sessionId: 42,
            capture: createCapture,
            before: null,
            after: "v1",
        });
        await fileIndex.read();
        expect(indexCommitCount).toBe(1);
        await recordAgentWorkspaceWrite({
            sessionId: 42,
            capture: captureAgentWorkspaceWrite(address, ready),
            before: "v1",
            after: null,
        });
        await fileIndex.read();
        expect(indexCommitCount).toBe(2);

        const history = await requireReadyModuleHandle(
            ready,
            PROJECT_HISTORY_MODULE_TOKEN,
        ).history;
        expect(history).not.toBeNull();
        const timeline = await history!.timeline("manuscript/ch1.md");
        expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create", "file.delete"]);
        expect(timeline[0]!.entry.actor).toEqual({kind: "agent", sessionId: "42"});

        // 未 open 的项目：反推成功但 record 静默跳过（fail-open）
        await recordAgentWorkspaceWrite({
            sessionId: 42,
            capture: captureAgentWorkspaceWrite(
                resolveFileAddress(scope, "workspace/not-open/manuscript/x.md"),
                undefined,
            ),
            before: null, after: "x",
        });
        const notOpenProjectPath = normalizeProjectPath("workspace/not-open");
        expect(() => requireReadyProjectPath(notOpenProjectPath)).toThrow();
    });

    it("显式跨Project地址直接按ResolvedFileAddress归入目标Project", async () => {
        const currentProjectPath = normalizeProjectPath("workspace/current");
        const targetProjectPath = normalizeProjectPath("workspace/target");
        await writeProjectManifest(workspaceRoot, currentProjectPath, {kind: "novel", title: "current", summary: ""});
        await writeProjectManifest(workspaceRoot, targetProjectPath, {kind: "novel", title: "target", summary: ""});
        await openProjectForTest(currentProjectPath);
        await openProjectForTest(targetProjectPath);
        const currentReady = requireReadyProjectPath(currentProjectPath);
        const targetReady = requireReadyProjectPath(targetProjectPath);
        const scope = createFileScope({kind: "managed-project", workspaceRoot, projectPath: currentProjectPath});
        const address = resolveFileAddress(scope, "workspace/target/lorebook/npc.md");

        await recordAgentWorkspaceWrite({
            sessionId: 7,
            capture: captureAgentWorkspaceWrite(address, targetReady),
            before: null,
            after: "npc",
        });

        const targetHistory = await requireReadyModuleHandle(
            targetReady,
            PROJECT_HISTORY_MODULE_TOKEN,
        ).history;
        expect(targetHistory).not.toBeNull();
        expect((await targetHistory!.timeline("lorebook/npc.md"))[0]?.entry.actor)
            .toEqual({kind: "agent", sessionId: "7"});
        const currentHistory = await requireReadyModuleHandle(
            currentReady,
            PROJECT_HISTORY_MODULE_TOKEN,
        ).history;
        expect(currentHistory).not.toBeNull();
        expect(await currentHistory!.timeline("lorebook/npc.md")).toEqual([]);
    });

    it("close/reopen后旧capture不会把记录写入新generation", async () => {
        const projectPath = normalizeProjectPath("workspace/generation-safe");
        await writeProjectManifest(workspaceRoot, projectPath, {kind: "novel", title: "generation-safe", summary: ""});
        await openProjectForTest(projectPath);

        const scope = createFileScope({kind: "managed-project", workspaceRoot, projectPath});
        const address = resolveFileAddress(scope, "manuscript/ch1.md");
        const oldReady = requireReadyProjectPath(projectPath);
        const oldCapture = captureAgentWorkspaceWrite(address, oldReady);
        expect(oldCapture).not.toBeNull();

        await closeProjectForTest(projectPath);
        await openProjectForTest(projectPath);
        const currentReady = requireReadyProjectPath(projectPath);

        await expect(recordAgentWorkspaceWrite({
            sessionId: 99,
            capture: oldCapture,
            before: null,
            after: "must-not-cross-generation",
        })).resolves.toBeUndefined();

        const currentHistory = await requireReadyModuleHandle(
            currentReady,
            PROJECT_HISTORY_MODULE_TOKEN,
        ).history;
        expect(currentHistory).not.toBeNull();
        expect(await currentHistory!.timeline("manuscript/ch1.md")).toEqual([]);
    });
});
