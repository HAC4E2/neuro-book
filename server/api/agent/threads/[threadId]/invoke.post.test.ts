import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/agent/threads/[threadId]/invoke", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("有 client variables 时会先同步，再派发 thread run", async () => {
        const agentSystem = {
            syncClientVariables: vi.fn(async () => {}),
            dispatchThreadRunById: vi.fn(async () => {}),
        };

        vi.doMock("nbook/server/agent/api", () => ({
            requireThreadId: vi.fn(() => "thread-1"),
            readClientVariablesHeader: vi.fn(() => ({studio: {novelId: "1"}})),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
        }));
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                mode: "prompt",
                input: {prompt: "hello"},
                options: {},
            })),
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId]/invoke.post")).default;
        const result = await handler({} as never);

        expect(agentSystem.syncClientVariables).toHaveBeenCalledWith("thread-1", {studio: {novelId: "1"}});
        expect(agentSystem.dispatchThreadRunById).toHaveBeenCalledWith("thread-1", {prompt: "hello"}, {});
        expect(result).toEqual({ok: true});
    });

    it("continue 模式会转成 leader continue 输入", async () => {
        const agentSystem = {
            syncClientVariables: vi.fn(async () => {}),
            dispatchThreadRunById: vi.fn(async () => {}),
        };

        vi.doMock("nbook/server/agent/api", () => ({
            requireThreadId: vi.fn(() => "thread-1"),
            readClientVariablesHeader: vi.fn(() => null),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
        }));
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                mode: "continue",
                options: {},
            })),
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId]/invoke.post")).default;
        await handler({} as never);

        expect(agentSystem.dispatchThreadRunById).toHaveBeenCalledWith("thread-1", {mode: "continue"}, {});
    });

    it("下游失败时会原样抛出错误", async () => {
        const error = new Error("dispatch boom");
        const agentSystem = {
            syncClientVariables: vi.fn(async () => {}),
            dispatchThreadRunById: vi.fn(async () => {
                throw error;
            }),
        };

        vi.doMock("nbook/server/agent/api", () => ({
            requireThreadId: vi.fn(() => "thread-1"),
            readClientVariablesHeader: vi.fn(() => null),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
        }));
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                mode: "prompt",
                input: {prompt: "hello"},
                options: {},
            })),
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId]/invoke.post")).default;

        await expect(handler({} as never)).rejects.toBe(error);
    });
});
