import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/agent/threads/[threadId]/subagents", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("会同步 client variables、创建 subagent，并返回对应摘要", async () => {
        const agentSystem = {
            syncClientVariables: vi.fn(async () => {}),
            createSubAgentThread: vi.fn(async () => ({id: "subagent-1"})),
            listSubAgents: vi.fn(async () => [{
                id: "subagent-1",
                kind: "subagent",
                profileKey: "subagent.writer",
                title: "writer",
                summary: "摘要",
                status: "idle",
                lastMessageAt: new Date("2026-04-05T00:00:00.000Z"),
            }]),
        };
        const toAgentSubagentSummaryDto = vi.fn((summary) => ({
            ...summary,
            mapped: true,
        }));

        vi.doMock("nbook/server/agent/api", () => ({
            requireThreadId: vi.fn(() => "thread-1"),
            readClientVariablesHeader: vi.fn(() => ({ide: {theme: "sepia"}})),
        }));
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                profileKey: "subagent.writer",
                title: "writer",
            })),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
            toAgentSubagentSummaryDto,
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId]/subagents.post")).default;
        const result = await handler({} as never);

        expect(agentSystem.syncClientVariables).toHaveBeenCalledWith("thread-1", {ide: {theme: "sepia"}});
        expect(agentSystem.createSubAgentThread).toHaveBeenCalledWith({
            leaderThreadId: "thread-1",
            profileKey: "subagent.writer",
            title: "writer",
        });
        expect(result).toMatchObject({
            id: "subagent-1",
            mapped: true,
        });
    });

    it("创建后找不到摘要时会抛 500", async () => {
        const agentSystem = {
            syncClientVariables: vi.fn(async () => {}),
            createSubAgentThread: vi.fn(async () => ({id: "subagent-1"})),
            listSubAgents: vi.fn(async () => []),
        };

        vi.doMock("nbook/server/agent/api", () => ({
            requireThreadId: vi.fn(() => "thread-1"),
            readClientVariablesHeader: vi.fn(() => null),
        }));
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({
                profileKey: "subagent.writer",
                title: "writer",
            })),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
            toAgentSubagentSummaryDto: vi.fn(),
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId]/subagents.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 500,
            message: "创建 subagent 后未找到摘要",
        });
    });
});
