import {describe, expect, it, vi} from "vitest";
vi.mock("nbook/server/agent/agent-system", () => ({
    AgentSystem: {
        createDefault: () => {
            throw new Error("http.test 不应初始化默认 AgentSystem");
        },
    },
}));
import {toAgentThreadSnapshotEventDto} from "nbook/server/agent/http";
import {createConversationNode, createThreadSummary} from "nbook/server/agent/test/fixtures";
import type {ThreadSnapshotProjection} from "nbook/server/agent/services/thread-projection.service";

describe("agent http projection", () => {
    it("会把历史树节点投影到 thread_snapshot.conversationTree", () => {
        const payload = toAgentThreadSnapshotEventDto({
            thread: createThreadSummary(),
            subagents: [],
            leaders: [],
            conversationTree: {
                revision: 2,
                activeCursorId: "tool-message-1",
                rootNodeId: "assistant-1",
                nodes: [
                    createConversationNode({
                        id: "assistant-1",
                        role: "assistant",
                        content: "这里是回答",
                        rawAdditionalKwargs: {
                            thinking: "思考内容",
                        },
                    }),
                    createConversationNode({
                        id: "tool-message-1",
                        parentId: "assistant-1",
                        role: "tool",
                        origin: "tool_result",
                        content: "读取成功",
                        assistantMessageId: "assistant-1",
                        toolCallId: "call-1",
                        toolName: "read_file",
                        toolArgs: "{\"filePath\":\"chapter.md\"}",
                        toolStatus: "success",
                        rawAdditionalKwargs: {
                            toolNodeId: "assistant-1-tool-0",
                        },
                    }),
                ],
            },
            activeRun: null,
        } satisfies ThreadSnapshotProjection);

        expect(payload.type).toBe("thread_snapshot");
        expect(payload.conversationTree.revision).toBe(2);
        expect(payload.conversationTree.nodes).toHaveLength(2);
        expect(payload.conversationTree.nodes[0]).toMatchObject({
            id: "assistant-1",
            role: "assistant",
        });
    });

    it("会保留 tool 节点的 assistantMessageId", () => {
        const payload = toAgentThreadSnapshotEventDto({
            thread: createThreadSummary(),
            subagents: [],
            leaders: [],
            conversationTree: {
                revision: 1,
                activeCursorId: "tool-message-1",
                rootNodeId: "assistant-1",
                nodes: [
                    createConversationNode({
                        id: "assistant-1",
                        role: "assistant",
                    }),
                    createConversationNode({
                        id: "tool-message-1",
                        parentId: "assistant-1",
                        role: "tool",
                        origin: "tool_result",
                        assistantMessageId: "assistant-1",
                        toolName: "read_file",
                        toolStatus: "success",
                    }),
                ],
            },
            activeRun: null,
        });

        expect(payload.conversationTree.nodes[1]).toMatchObject({
            assistantMessageId: "assistant-1",
            toolName: "read_file",
        });
    });
});
