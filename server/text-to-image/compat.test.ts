import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    resolveGlobalProfileNbookRoot,
    resolveWorkspaceRootInput,
} from "nbook/server/text-to-image/compat";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";

describe("text-to-image runtime path compatibility", () => {
    afterEach(() => {
        setWorkspaceRuntimeRootContextForTest(null);
    });

    it("projectPath 解析为具体 Project Workspace，而不是 Workspace Root", async () => {
        const workspaceRoot = path.resolve(".agent", "text-to-image-compat", "workspace");
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});

        await expect(resolveWorkspaceRootInput({projectPath: "workspace/demo"}))
            .resolves.toBe(path.join(workspaceRoot, "demo"));
    });

    it("全局 Profile Home 固定落在 Workspace Root .nbook", () => {
        const workspaceRoot = path.resolve(".agent", "text-to-image-global-home", "workspace");
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});

        expect(resolveGlobalProfileNbookRoot()).toBe(path.join(workspaceRoot, ".nbook"));
        expect(resolveGlobalProfileNbookRoot(workspaceRoot)).toBe(path.join(workspaceRoot, ".nbook"));
    });
});
