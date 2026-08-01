import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    mkdir: vi.fn(async () => undefined),
    inspectStateRootIntegrity: vi.fn(async () => ({kind: "clean"})),
    stateRootIntegrityFailed: vi.fn(() => false),
    assertProductMigrationsReady: vi.fn(async () => undefined),
    startAgentSessionStoreRuntime: vi.fn(async () => ({rootWorkspace: "C:/state/workspace"})),
    warn: vi.fn(async () => undefined),
}));

vi.mock("node:fs/promises", () => ({mkdir: mocks.mkdir}));
vi.mock("nbook/server/runtime/paths/runtime-paths", () => ({
    runtimePathsFromEnv: () => ({
        applicationRoot: "C:/application",
        stateRoot: "C:/state",
        workspaceRoot: "C:/state/workspace",
    }),
}));
vi.mock("nbook/server/runtime/state-root-integrity", () => ({
    inspectStateRootIntegrity: mocks.inspectStateRootIntegrity,
    stateRootIntegrityFailed: mocks.stateRootIntegrityFailed,
}));
vi.mock("nbook/server/runtime/product-migration-gate", () => ({
    assertProductMigrationsReady: mocks.assertProductMigrationsReady,
}));
vi.mock("nbook/server/agent/session/agent-session-store-runtime", () => ({
    startAgentSessionStoreRuntime: mocks.startAgentSessionStoreRuntime,
}));
vi.mock("nbook/server/app-logs/logger", () => ({appLogger: {warn: mocks.warn}}));

import {prepareProductRuntime} from "nbook/server/runtime/product-startup";

describe("Product startup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.inspectStateRootIntegrity.mockResolvedValue({kind: "clean"});
        mocks.stateRootIntegrityFailed.mockReturnValue(false);
        mocks.assertProductMigrationsReady.mockResolvedValue(undefined);
        mocks.startAgentSessionStoreRuntime.mockResolvedValue({rootWorkspace: "C:/state/workspace"});
    });

    it("按 Workspace、migration、Session Store 顺序完成完整 ready 门禁", async () => {
        await prepareProductRuntime();

        expect(mocks.mkdir).toHaveBeenCalledWith("C:/state/workspace", {recursive: true});
        expect(mocks.inspectStateRootIntegrity).toHaveBeenCalledWith({
            installationRoot: "C:/application",
            stateRoot: "C:/state",
        });
        expect(mocks.assertProductMigrationsReady).toHaveBeenCalledOnce();
        expect(mocks.startAgentSessionStoreRuntime).toHaveBeenCalledWith("C:/state/workspace");
        expect(mocks.mkdir.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.assertProductMigrationsReady.mock.invocationCallOrder[0]!,
        );
        expect(mocks.assertProductMigrationsReady.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.startAgentSessionStoreRuntime.mock.invocationCallOrder[0]!,
        );
    });

    it("影子 Workspace 只记录证据，不自动修改用户数据", async () => {
        const stateIntegrity = {kind: "shadow-workspace"};
        mocks.inspectStateRootIntegrity.mockResolvedValue(stateIntegrity);
        mocks.stateRootIntegrityFailed.mockReturnValue(true);

        await prepareProductRuntime();

        expect(mocks.warn).toHaveBeenCalledWith(
            "runtime.stateRoot.integrityFailed",
            {stateIntegrity},
            expect.stringContaining("不会自动处理用户数据"),
        );
    });

    it("migration 未 ready 时绝不取得 Session Store lease", async () => {
        mocks.assertProductMigrationsReady.mockRejectedValue(new Error("migration pending"));

        await expect(prepareProductRuntime()).rejects.toThrow("migration pending");

        expect(mocks.startAgentSessionStoreRuntime).not.toHaveBeenCalled();
    });
});
