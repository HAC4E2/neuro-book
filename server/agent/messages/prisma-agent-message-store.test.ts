import {HumanMessage, mapChatMessagesToStoredMessages} from "@langchain/core/messages";
import type {AgentMessage as PrismaAgentMessage} from "nbook/server/generated/prisma/client";
import {describe, expect, it, vi} from "vitest";
import {PrismaAgentMessageStore} from "nbook/server/agent/messages/prisma-agent-message-store";
import type {AgentMessageStoreSnapshot} from "nbook/server/agent/types";

vi.mock("nbook/server/utils/prisma", () => ({
    prisma: {},
}));

type SnapshotLoader = {
    loadSnapshotFromTransaction(tx: {
        agentThread: {
            findUniqueOrThrow(input: unknown): Promise<{activeCursorMessageId: string | null}>;
        };
        agentMessage: {
            findMany(input: unknown): Promise<PrismaAgentMessage[]>;
        };
    }, threadDbId: number): Promise<AgentMessageStoreSnapshot>;
};

describe("PrismaAgentMessageStore", () => {
    it("加载快照时会在完整节点集合上重建 childIds", async () => {
        const createdAt = new Date("2026-05-07T00:00:00.000Z");
        const messages: PrismaAgentMessage[] = [
            createPrismaMessage("root", null, createdAt),
            createPrismaMessage("user-1", "root", new Date("2026-05-07T00:00:01.000Z")),
            createPrismaMessage("assistant-1", "user-1", new Date("2026-05-07T00:00:02.000Z")),
        ];
        const tx = {
            agentThread: {
                findUniqueOrThrow: vi.fn(async () => ({activeCursorMessageId: "assistant-1"})),
            },
            agentMessage: {
                findMany: vi.fn(async () => messages),
            },
        };
        const store = new PrismaAgentMessageStore() as unknown as SnapshotLoader;

        const snapshot = await store.loadSnapshotFromTransaction(tx, 1);

        expect(snapshot.nodesById.root?.childIds).toEqual(["user-1"]);
        expect(snapshot.nodesById["user-1"]?.childIds).toEqual(["assistant-1"]);
        expect(snapshot.nodesById["assistant-1"]?.childIds).toEqual([]);
    });
});

function createPrismaMessage(id: string, parentId: string | null, createdAt: Date): PrismaAgentMessage {
    return {
        id,
        threadId: 1,
        parentId,
        status: "done",
        storedMessage: JSON.parse(JSON.stringify(mapChatMessagesToStoredMessages([new HumanMessage(id)])[0]!)) as PrismaAgentMessage["storedMessage"],
        archivedAt: null,
        createdAt,
        updatedAt: createdAt,
    };
}
