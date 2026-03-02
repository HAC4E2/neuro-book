import {beforeEach, describe, expect, it, vi} from "vitest";

describe("PATCH /api/agent/threads/[threadId]/messages/[messageId]", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("会调用消息改写接口并返回最新历史树", async () => {
        const agentSystem = {
            updateThreadMessage: vi.fn(async () => {}),
            getThreadDetailProjection: vi.fn(async () => ({
                conversationTree: {
                    revision: 2,
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
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({content: "改写后的消息"})),
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId]/messages/[messageId].patch")).default;
        const result = await handler({} as never);

        expect(agentSystem.updateThreadMessage).toHaveBeenCalledWith("thread-1", "message-1", "改写后的消息");
        expect(result).toEqual({
            ok: true,
            conversationTree: {
                revision: 2,
                activeCursorId: "message-1",
                rootNodeId: "root-1",
                nodes: [],
            },
        });
    });
});
