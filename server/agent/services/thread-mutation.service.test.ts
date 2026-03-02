import {describe, expect, it, vi} from "vitest";
import {ThreadMutationService} from "nbook/server/agent/services/thread-mutation.service";
import {createAgentMessage, createThreadRecord} from "nbook/server/agent/test/fixtures";
import type {AgentMessageStore} from "nbook/server/agent/messages/agent-message-store";
import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";
import type {AgentMessageStoreSnapshot} from "nbook/server/agent/types";

describe("ThreadMutationService", () => {
    it("创建用户消息时会标记为真实用户输入", async () => {
        const appendMessages = vi.fn(async () => []);
        const store = createStoreMock(createSnapshot({
            activeCursorId: null,
            nodes: [],
        }), {
            appendMessages,
        });
        const service = createService(store);

        await service.createUserMessage("thread-1", "新问题");

        expect(appendMessages).toHaveBeenCalledWith("thread-1", {
            messages: [
                expect.objectContaining({
                    message: expect.objectContaining({
                        additional_kwargs: expect.objectContaining({
                            userInput: true,
                        }),
                    }),
                }),
            ],
        });
    });

    it("编辑用户消息时会在原父节点下追加 sibling user", async () => {
        const appendMessages = vi.fn(async () => []);
        const store = createStoreMock(createSnapshot({
            activeCursorId: "a1",
            nodes: [
                createAgentMessage({
                    id: "u1",
                    role: "user",
                    origin: "user_input",
                    content: "旧问题",
                    childIds: ["a1"],
                }),
                createAgentMessage({
                    id: "a1",
                    parentId: "u1",
                    role: "assistant",
                    origin: "assistant_output",
                    content: "旧回答",
                }),
            ],
        }), {
            appendMessages,
        });
        const service = createService(store);

        await service.updateMessage("thread-1", "u1", "新问题");

        expect(appendMessages).toHaveBeenCalledWith("thread-1", {
            parentId: null,
            messages: [
                expect.objectContaining({
                    status: "done",
                    message: expect.objectContaining({
                        content: "新问题",
                        additional_kwargs: expect.objectContaining({
                            userInput: true,
                        }),
                    }),
                }),
            ],
        });
        expect(store.archiveMessages).not.toHaveBeenCalled();
        expect(store.updateMessage).not.toHaveBeenCalled();
        expect(store.setActiveCursor).not.toHaveBeenCalled();
    });

    it("编辑 AI 消息时会原地改写并归档其后的活动路径", async () => {
        const archiveMessages = vi.fn(async () => {});
        const updateMessage = vi.fn(async () => createAgentMessage({
            id: "a1",
            parentId: "u1",
            role: "assistant",
            origin: "assistant_output",
            content: "改写后的回答",
        }));
        const setActiveCursor = vi.fn(async () => {});
        const store = createStoreMock(createSnapshot({
            activeCursorId: "a2",
            nodes: [
                createAgentMessage({
                    id: "u1",
                    role: "user",
                    origin: "user_input",
                    content: "问题",
                    childIds: ["a1"],
                }),
                createAgentMessage({
                    id: "a1",
                    parentId: "u1",
                    childIds: ["u2"],
                    role: "assistant",
                    origin: "assistant_output",
                    content: "旧回答",
                }),
                createAgentMessage({
                    id: "u2",
                    parentId: "a1",
                    childIds: ["a2"],
                    role: "user",
                    origin: "user_input",
                    content: "后续追问",
                }),
                createAgentMessage({
                    id: "a2",
                    parentId: "u2",
                    role: "assistant",
                    origin: "assistant_output",
                    content: "后续回答",
                }),
            ],
        }), {
            archiveMessages,
            updateMessage,
            setActiveCursor,
        });
        const service = createService(store);

        await service.updateMessage("thread-1", "a1", "改写后的回答");

        expect(archiveMessages).toHaveBeenCalledWith("thread-1", ["u2", "a2"]);
        expect(updateMessage).toHaveBeenCalledWith("thread-1", {
            messageId: "a1",
            content: "改写后的回答",
        });
        expect(setActiveCursor).toHaveBeenCalledWith("thread-1", "a1");
    });

    it("回退首条消息时会保留该消息并归档其后的 continuation", async () => {
        const archiveMessages = vi.fn(async () => {});
        const setActiveCursor = vi.fn(async () => {});
        const store = createStoreMock(createSnapshot({
            activeCursorId: "a1",
            nodes: [
                createAgentMessage({
                    id: "u1",
                    role: "user",
                    origin: "user_input",
                    childIds: ["a1"],
                }),
                createAgentMessage({
                    id: "a1",
                    parentId: "u1",
                    role: "assistant",
                    origin: "assistant_output",
                }),
            ],
        }), {
            archiveMessages,
            setActiveCursor,
        });
        const service = createService(store);

        await service.rollbackMessage("thread-1", "u1");

        expect(archiveMessages).toHaveBeenCalledWith("thread-1", ["a1"]);
        expect(setActiveCursor).toHaveBeenCalledWith("thread-1", "u1");
    });

    it("回退叶子消息时不会归档任何后续，但会把光标停在当前消息", async () => {
        const archiveMessages = vi.fn(async () => {});
        const setActiveCursor = vi.fn(async () => {});
        const store = createStoreMock(createSnapshot({
            activeCursorId: "a1",
            nodes: [
                createAgentMessage({
                    id: "u1",
                    role: "user",
                    origin: "user_input",
                    childIds: ["a1"],
                }),
                createAgentMessage({
                    id: "a1",
                    parentId: "u1",
                    role: "assistant",
                    origin: "assistant_output",
                }),
            ],
        }), {
            archiveMessages,
            setActiveCursor,
        });
        const service = createService(store);

        await service.rollbackMessage("thread-1", "a1");

        expect(archiveMessages).not.toHaveBeenCalled();
        expect(setActiveCursor).toHaveBeenCalledWith("thread-1", "a1");
    });

    it("刷新用户消息时会切回该 user", async () => {
        const setActiveCursor = vi.fn(async () => {});
        const store = createStoreMock(createSnapshot({
            activeCursorId: "a1",
            nodes: [
                createAgentMessage({
                    id: "u1",
                    role: "user",
                    origin: "user_input",
                    childIds: ["a1"],
                    content: "问题",
                }),
                createAgentMessage({
                    id: "a1",
                    parentId: "u1",
                    role: "assistant",
                    origin: "assistant_output",
                    content: "回答",
                }),
            ],
        }), {
            setActiveCursor,
        });
        const service = createService(store);

        await service.refreshMessage("thread-1", "u1");

        expect(setActiveCursor).toHaveBeenCalledWith("thread-1", "u1");
    });

    it("刷新 AI 消息时会回到最近 user 并归档其后的 continuation", async () => {
        const archiveMessages = vi.fn(async () => {});
        const setActiveCursor = vi.fn(async () => {});
        const store = createStoreMock(createSnapshot({
            activeCursorId: "a2",
            nodes: [
                createAgentMessage({
                    id: "u1",
                    role: "user",
                    origin: "user_input",
                    childIds: ["a1"],
                    content: "问题",
                }),
                createAgentMessage({
                    id: "a1",
                    parentId: "u1",
                    childIds: ["u2"],
                    role: "assistant",
                    origin: "assistant_output",
                    content: "回答",
                }),
                createAgentMessage({
                    id: "u2",
                    parentId: "a1",
                    childIds: ["a2"],
                    role: "user",
                    origin: "user_input",
                    content: "追问",
                }),
                createAgentMessage({
                    id: "a2",
                    parentId: "u2",
                    role: "assistant",
                    origin: "assistant_output",
                    content: "追答",
                }),
            ],
        }), {
            archiveMessages,
            setActiveCursor,
        });
        const service = createService(store);

        await service.refreshMessage("thread-1", "a2");

        expect(archiveMessages).toHaveBeenCalledWith("thread-1", ["a2"]);
        expect(setActiveCursor).toHaveBeenCalledWith("thread-1", "u2");
    });

    it("刷新 AI 消息遇到最近 tool 时会回退到 tool", async () => {
        const archiveMessages = vi.fn(async () => {});
        const setActiveCursor = vi.fn(async () => {});
        const store = createStoreMock(createSnapshot({
            activeCursorId: "a2",
            nodes: [
                createAgentMessage({
                    id: "u1",
                    role: "user",
                    origin: "user_input",
                    childIds: ["a1"],
                    content: "问题",
                }),
                createAgentMessage({
                    id: "a1",
                    parentId: "u1",
                    childIds: ["t1"],
                    role: "assistant",
                    origin: "assistant_output",
                    content: "准备调工具",
                }),
                createAgentMessage({
                    id: "t1",
                    parentId: "a1",
                    childIds: ["a2"],
                    role: "tool",
                    origin: "tool_result",
                    assistantMessageId: "a1",
                    toolName: "read_file",
                    toolStatus: "success",
                    content: "工具结果",
                }),
                createAgentMessage({
                    id: "a2",
                    parentId: "t1",
                    role: "assistant",
                    origin: "assistant_output",
                    content: "基于工具的回答",
                }),
            ],
        }), {
            archiveMessages,
            setActiveCursor,
        });
        const service = createService(store);

        await service.refreshMessage("thread-1", "a2");

        expect(archiveMessages).toHaveBeenCalledWith("thread-1", ["a2"]);
        expect(setActiveCursor).toHaveBeenCalledWith("thread-1", "t1");
    });

    it("激活 continuation 时会进入目标节点的默认叶子", async () => {
        const setActiveCursor = vi.fn(async () => {});
        const store = createStoreMock(createSnapshot({
            activeCursorId: "a1",
            nodes: [
                createAgentMessage({
                    id: "u1",
                    role: "user",
                    origin: "user_input",
                    childIds: ["a1", "a2"],
                }),
                createAgentMessage({
                    id: "a1",
                    parentId: "u1",
                    role: "assistant",
                    origin: "assistant_output",
                    createdAt: "2026-04-05T00:00:00.000Z",
                }),
                createAgentMessage({
                    id: "a2",
                    parentId: "u1",
                    childIds: ["u2"],
                    role: "assistant",
                    origin: "assistant_output",
                    createdAt: "2026-04-05T00:01:00.000Z",
                }),
                createAgentMessage({
                    id: "u2",
                    parentId: "a2",
                    role: "user",
                    origin: "user_input",
                    createdAt: "2026-04-05T00:02:00.000Z",
                }),
            ],
        }), {
            setActiveCursor,
        });
        const service = createService(store);

        await service.activateMessage("thread-1", "u1");

        expect(setActiveCursor).toHaveBeenCalledWith("thread-1", "u2");
    });

    it("运行中线程会拒绝消息改写", async () => {
        const service = new ThreadMutationService(
            {
                loadSnapshot: vi.fn(),
            } as unknown as AgentMessageStore,
            {
                findById: vi.fn(async () => createThreadRecord({id: 1, runStatus: "running"})),
            } as unknown as ThreadRepository,
        );

        await expect(service.rollbackMessage("thread-1", "u1")).rejects.toMatchObject({
            statusCode: 400,
            message: "线程正在运行中，暂时不能改写历史消息",
        });
    });
});

function createService(store: AgentMessageStore): ThreadMutationService {
    return new ThreadMutationService(
        store,
        {
            findById: vi.fn(async () => createThreadRecord({id: 1})),
        } as unknown as ThreadRepository,
    );
}

function createStoreMock(
    snapshot: AgentMessageStoreSnapshot,
    overrides: Partial<Record<keyof AgentMessageStore, ReturnType<typeof vi.fn>>> = {},
): AgentMessageStore & {
    appendMessages: ReturnType<typeof vi.fn>;
    archiveMessages: ReturnType<typeof vi.fn>;
    insertMessagesBefore: ReturnType<typeof vi.fn>;
    loadSnapshot: ReturnType<typeof vi.fn>;
    prependMessages: ReturnType<typeof vi.fn>;
    setActiveCursor: ReturnType<typeof vi.fn>;
    updateMessage: ReturnType<typeof vi.fn>;
} {
    const store = {
        loadSnapshot: vi.fn(async () => snapshot),
        loadActivePathMessages: vi.fn(async () => []),
        loadBranchMessages: vi.fn(async () => []),
        appendMessages: vi.fn(async () => []),
        insertMessagesBefore: vi.fn(async () => []),
        prependMessages: vi.fn(async () => []),
        setActiveCursor: vi.fn(async () => {}),
        updateMessage: vi.fn(async () => createAgentMessage()),
        archiveMessages: vi.fn(async () => {}),
        deleteThread: vi.fn(async () => {}),
    };
    Object.assign(store, overrides);
    return store;
}

function createSnapshot(input: {
    activeCursorId: string | null;
    nodes: ReturnType<typeof createAgentMessage>[];
}): AgentMessageStoreSnapshot {
    return {
        version: 3,
        revision: 1,
        activeCursorId: input.activeCursorId,
        rootNodeId: input.nodes[0]?.id ?? null,
        nodesById: Object.fromEntries(input.nodes.map((node) => [node.id, node])),
    };
}
