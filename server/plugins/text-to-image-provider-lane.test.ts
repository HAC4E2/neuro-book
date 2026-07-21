import {afterEach, describe, expect, it, vi} from "vitest";

const runtimeCalls = vi.hoisted(() => ({starts: 0, stops: 0}));

vi.mock("nitropack/runtime", () => ({defineNitroPlugin: <T>(plugin: T): T => plugin}));
vi.mock("nbook/server/app-logs/logger", () => ({
    appLogger: {info: vi.fn(async () => undefined), debug: vi.fn(), warn: vi.fn()},
}));
vi.mock("nbook/server/utils/prisma", () => ({prisma: {}}));
vi.mock("nbook/server/text-to-image/dispatch-preparation.repository", () => ({PrismaDispatchPreparationRepository: class {}}));
vi.mock("nbook/server/text-to-image/dispatch-reconciler", () => ({DispatchReconciler: class {}}));
vi.mock("nbook/server/text-to-image/illustration-dispatch.worker", () => ({IllustrationDispatchWorker: class {}}));
vi.mock("nbook/server/text-to-image/project-dispatch.repository", () => ({ProjectDispatchRepository: class {}}));
vi.mock("nbook/server/text-to-image/project-illustration-dispatch", () => ({ProjectIllustrationDispatch: class {}}));
vi.mock("nbook/server/text-to-image/provider-lane.repository", () => ({ProviderLaneRepository: class {}}));
vi.mock("nbook/server/text-to-image/provider-reconciliation.service", () => ({ProjectTextToImageProviderJobReconciler: class {}}));
vi.mock("nbook/server/text-to-image/provider-revision-invalidation.reconciler", () => ({ProviderRevisionInvalidationReconciler: class {}}));
vi.mock("nbook/server/text-to-image/provider.service", () => ({PrismaTextToImageProviderStore: class {}}));
vi.mock("nbook/server/text-to-image/provider-lane.runtime", () => ({
    ProviderLaneRuntime: class {
        /** 记录全局 runtime 实际启动次数。 */
        start(): void {
            runtimeCalls.starts += 1;
        }

        /** 记录最后 owner 关闭后实际停止次数。 */
        async stop(): Promise<void> {
            runtimeCalls.stops += 1;
        }
    },
}));

import textToImageProviderLanePlugin from "nbook/server/plugins/text-to-image-provider-lane";

type FakeNitroApp = {
    hooks: {
        hook(event: "close", handler: () => Promise<void>): void;
    };
};

const globalLane = globalThis as typeof globalThis & {__nbookTextToImageProviderLane?: object};

describe("text-to-image Provider lane Nitro ownership", () => {
    afterEach(() => {
        delete globalLane.__nbookTextToImageProviderLane;
        runtimeCalls.starts = 0;
        runtimeCalls.stops = 0;
    });

    it("reuses one runtime across two Nitro owners and stops only after the final close", async () => {
        const first = fakeNitroApp();
        const second = fakeNitroApp();
        const runPlugin = textToImageProviderLanePlugin as (app: FakeNitroApp) => void;

        runPlugin(first.app);
        runPlugin(second.app);
        expect(runtimeCalls).toEqual({starts: 1, stops: 0});

        await first.close();
        expect(runtimeCalls.stops).toBe(0);
        await second.close();
        expect(runtimeCalls.stops).toBe(1);

        const replacement = fakeNitroApp();
        runPlugin(replacement.app);
        expect(runtimeCalls.starts).toBe(2);
        await replacement.close();
        expect(runtimeCalls.stops).toBe(2);
    });
});

/** 构造只暴露 close hook 的最小 Nitro 生命周期夹具。 */
function fakeNitroApp(): {app: FakeNitroApp; close: () => Promise<void>} {
    let closeHandler: (() => Promise<void>) | null = null;
    return {
        app: {
            hooks: {
                hook(_event, handler) {
                    closeHandler = handler;
                },
            },
        },
        async close() {
            if (!closeHandler) throw new Error("测试 Nitro app 未注册 close hook");
            await closeHandler();
        },
    };
}
