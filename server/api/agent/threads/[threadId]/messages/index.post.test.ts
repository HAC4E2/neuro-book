import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/agent/threads/[threadId]/messages", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("会创建新的用户消息节点并返回最新历史树", async () => {
        const agentSystem = {
            createThreadMessage: vi.fn(async () => undefined),
            getThreadDetailProjection: vi.fn(async () => ({
                conversationTree: {
                    revision: 2,
                    activeCursorId: "message-1",
                    rootNodeId: "message-1",
                    nodes: [],
                },
            })),
        };

        vi.doMock("nbook/server/agent/api", () => ({
            requireThreadId: vi.fn(() => "thread-1"),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
            toAgentConversationTreeSnapshotDto: vi.fn((tree) => tree),
        }));
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({content: "新的用户消息"})),
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId]/messages/index.post")).default;
        const result = await handler({} as never);

        expect(agentSystem.createThreadMessage).toHaveBeenCalledWith("thread-1", "新的用户消息");
        expect(result).toEqual({
            ok: true,
            conversationTree: {
                revision: 2,
                activeCursorId: "message-1",
                rootNodeId: "message-1",
                nodes: [],
            },
        });
    });
});
