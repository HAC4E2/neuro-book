import {beforeEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

const mocks = vi.hoisted(() => ({
    requireProjectPathQuery: vi.fn(() => "workspace/rag-ready"),
    requireReadyProjectPath: vi.fn(),
    runReadyProjectOperation: vi.fn((_ready, operation: () => Promise<unknown>) => operation()),
}));

vi.mock("nbook/server/runtime/paths/runtime-paths", () => ({
    runtimePathsFromEnv: () => ({workspaceRoot: absoluteFsPath("C:/workspace-root")}),
}));

vi.mock("nbook/server/utils/novel-chapter", () => ({
    requireProjectPathQuery: mocks.requireProjectPathQuery,
}));

vi.mock("nbook/server/workspace-files/project-session", () => ({
    requireReadyProjectPath: mocks.requireReadyProjectPath,
    runReadyProjectOperation: mocks.runReadyProjectOperation,
}));

vi.mock("nbook/server/workspace-files/project-open-guard", () => ({
    withProjectNotOpenHttpError: (handler: () => Promise<unknown>) => handler(),
}));

describe("Project RAG HTTP target", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("旧 projectPath seam 只解析一次并返回 exact ready target", async () => {
        const ready = {generation: 7} as ReadyProjectSessionRef;
        mocks.requireReadyProjectPath.mockReturnValue(ready);
        const {requireProjectRagTarget} = await import("nbook/server/api/projects/rag/project-rag-http-target");

        const target = requireProjectRagTarget({} as never);

        expect(mocks.requireProjectPathQuery).toHaveBeenCalledOnce();
        expect(mocks.requireReadyProjectPath).toHaveBeenCalledOnce();
        expect(mocks.requireReadyProjectPath).toHaveBeenCalledWith("workspace/rag-ready");
        expect(target).toEqual({
            workspaceRoot: absoluteFsPath("C:/workspace-root"),
            project: ready,
        });
    });

    it("请求只捕获并登记一次 exact ready generation", async () => {
        const ready = {generation: 11} as ReadyProjectSessionRef;
        mocks.requireReadyProjectPath.mockReturnValue(ready);
        const handler = vi.fn(async (target: {project: ReadyProjectSessionRef}) => target.project.generation);
        const {withProjectRagTarget} = await import("nbook/server/api/projects/rag/project-rag-http-target");

        await expect(withProjectRagTarget({} as never, handler)).resolves.toBe(11);

        expect(mocks.requireProjectPathQuery).toHaveBeenCalledOnce();
        expect(mocks.requireReadyProjectPath).toHaveBeenCalledOnce();
        expect(mocks.runReadyProjectOperation).toHaveBeenCalledOnce();
        expect(mocks.runReadyProjectOperation).toHaveBeenCalledWith(ready, expect.any(Function));
        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith({
            workspaceRoot: absoluteFsPath("C:/workspace-root"),
            project: ready,
        });
    });
});
