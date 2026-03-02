import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/agent/threads/[threadId]/messages/[messageId]/refresh", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("会刷新指定消息并返回最新历史树", async () => {
        const agentSystem = {
            refreshThreadMessage: vi.fn(async () => undefined),
            getThreadDetailProjection: vi.fn(async () => ({
                conversationTree: {
                    revision: 5,
                    activeCursorId: "message-1",
                    rootNodeId: "root-1",
                    nodes: [],
                },
            })),
        };

        vi.doMock("nbook/server/agent/api", () => ({
            requireThreadId: vi.fn(() => "thread-1"),
            requireMessageId: vi.fn(() => "message-1"),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
            toAgentConversationTreeSnapshotDto: vi.fn((tree) => tree),
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId]/messages/[messageId]/refresh.post")).default;
        const result = await handler({} as never);

        expect(agentSystem.refreshThreadMessage).toHaveBeenCalledWith("thread-1", "message-1");
        expect(result).toEqual({
            ok: true,
            conversationTree: {
                revision: 5,
                activeCursorId: "message-1",
                rootNodeId: "root-1",
                nodes: [],
            },
        });
    });
});
