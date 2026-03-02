import {beforeEach, describe, expect, it, vi} from "vitest";

describe("GET /api/agent/threads/[threadId]", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("有 client variables 时会先同步，再返回详情 DTO", async () => {
        const agentSystem = {
            syncClientVariables: vi.fn(async () => {}),
            getThreadDetailProjection: vi.fn(async () => ({
                thread: {id: "thread-1"},
                subagents: [],
                leaders: [],
            })),
        };
        const toAgentThreadDetailDto = vi.fn((detail) => ({
            ...detail,
            mapped: true,
        }));

        vi.doMock("nbook/server/agent/api", () => ({
            requireThreadId: vi.fn(() => "thread-1"),
            readClientVariablesHeader: vi.fn(() => ({ide: {theme: "sepia"}})),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
            toAgentThreadDetailDto,
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId].get")).default;
        const result = await handler({} as never);

        expect(agentSystem.syncClientVariables).toHaveBeenCalledWith("thread-1", {ide: {theme: "sepia"}});
        expect(agentSystem.getThreadDetailProjection).toHaveBeenCalledWith("thread-1");
        expect(result).toMatchObject({
            mapped: true,
        });
    });

    it("查询不到线程时会抛 404", async () => {
        const agentSystem = {
            syncClientVariables: vi.fn(async () => {}),
            getThreadDetailProjection: vi.fn(async () => null),
        };

        vi.doMock("nbook/server/agent/api", () => ({
            requireThreadId: vi.fn(() => "thread-1"),
            readClientVariablesHeader: vi.fn(() => null),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
            toAgentThreadDetailDto: vi.fn(),
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId].get")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 404,
            message: "线程不存在",
        });
    });
});
