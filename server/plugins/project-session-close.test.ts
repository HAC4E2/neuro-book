import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    disposeAgentHarness: vi.fn(async () => undefined),
    closeAllProjects: vi.fn(async () => undefined),
    closeAllWorkspaceTreeIndexes: vi.fn(async () => undefined),
}));

vi.mock("nitropack/runtime", () => ({
    defineNitroPlugin: (plugin: unknown) => plugin,
}));

vi.mock("nbook/server/agent/http", () => ({
    disposeAgentHarness: mocks.disposeAgentHarness,
}));

vi.mock("nbook/server/workspace-files/project-session", () => ({
    closeAllProjects: mocks.closeAllProjects,
}));

vi.mock("nbook/server/workspace-files/project-workspace-index", () => ({
    closeAllWorkspaceTreeIndexes: mocks.closeAllWorkspaceTreeIndexes,
}));

import projectSessionClosePlugin from "nbook/server/plugins/project-session-close";

describe("Project runtime shutdown plugin", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.disposeAgentHarness.mockResolvedValue(undefined);
        mocks.closeAllProjects.mockResolvedValue(undefined);
        mocks.closeAllWorkspaceTreeIndexes.mockResolvedValue(undefined);
    });

    it("Nitro close同时收口Agent、ProjectSession与plain Workspace File Index", async () => {
        const close = installCloseHook();

        await close();

        expect(mocks.disposeAgentHarness).toHaveBeenCalledTimes(1);
        expect(mocks.closeAllProjects).toHaveBeenCalledTimes(1);
        expect(mocks.closeAllWorkspaceTreeIndexes).toHaveBeenCalledTimes(1);
    });

    it("前序关闭失败时仍尝试全部资源并汇总失败", async () => {
        const harnessFailure = new Error("agent shutdown failed");
        const indexFailure = new Error("plain index shutdown failed");
        mocks.disposeAgentHarness.mockRejectedValue(harnessFailure);
        mocks.closeAllWorkspaceTreeIndexes.mockRejectedValue(indexFailure);
        const close = installCloseHook();

        await expect(close()).rejects.toMatchObject({
            errors: expect.arrayContaining([harnessFailure, indexFailure]),
        });
        expect(mocks.closeAllProjects).toHaveBeenCalledTimes(1);
        expect(mocks.closeAllWorkspaceTreeIndexes).toHaveBeenCalledTimes(1);
    });
});

/** 安装Nitro close hook并返回其真实关闭回调。 */
function installCloseHook(): () => Promise<void> {
    let close: (() => Promise<void>) | null = null;
    const plugin = projectSessionClosePlugin as unknown as (app: {
        hooks: {hook(name: "close", handler: () => Promise<void>): void};
    }) => void;
    plugin({
        hooks: {
            hook(name, handler): void {
                expect(name).toBe("close");
                close = handler;
            },
        },
    });
    if (!close) {
        throw new Error("Project runtime shutdown plugin未注册close hook");
    }
    return close;
}
