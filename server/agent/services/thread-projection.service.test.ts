import {describe, expect, it} from "vitest";
import {ThreadProjectionService} from "nbook/server/agent/services/thread-projection.service";
import {LiveRunRegistry} from "nbook/server/agent/runtime/live-run-registry";
import {createAgentMessage, createThreadRecord, createThreadSummary} from "nbook/server/agent/test/fixtures";
import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";
import type {ThreadMessageService} from "nbook/server/agent/services/thread-message.service";
import {vi} from "vitest";

describe("ThreadProjectionService", () => {
    it("会聚合线程详情和 subagent/leaders", async () => {
        const service = new ThreadProjectionService(
            {
                findById: async () => createThreadRecord(),
                listSubAgents: async () => [
                    createThreadSummary({
                        id: "subagent-1",
                        kind: "subagent",
                        profileKey: "subagent.writer",
                    }),
                ],
                listManagingLeaders: async () => [],
            } as unknown as ThreadRepository,
            {
                loadConversationTree: async () => ({
                    revision: 0,
                    activeCursorId: null,
                    rootNodeId: null,
                    nodes: [],
                }),
                collectThreadCumulativeUsage: async () => null,
            } as unknown as ThreadMessageService,
            new LiveRunRegistry(),
        );

        const detail = await service.getThreadDetail("thread-1");

        expect(detail?.thread).toMatchObject({
            id: "1",
            profileKey: "leader.default",
        });
        expect(detail?.subagents).toHaveLength(1);
        expect(detail?.leaders).toEqual([]);
        expect(detail?.conversationTree.revision).toBe(0);
    });

    it("会把 active run 快照一起投影出来", async () => {
        const liveRuns = new LiveRunRegistry();
        const session = liveRuns.open("thread-1", "leader.default");
        session.appendThinkingText("思考");
        session.appendAssistantText("输出");
        session.ensureToolDraft({
            callIndex: 0,
            toolName: "read_file",
            toolCallId: "call-1",
        });

        const service = new ThreadProjectionService(
            {
                findById: async () => createThreadRecord(),
                listSubAgents: async () => [],
                listManagingLeaders: async () => [],
            } as unknown as ThreadRepository,
            {
                loadConversationTree: async () => ({
                    revision: 1,
                    activeCursorId: "assistant-1",
                    rootNodeId: "assistant-1",
                    nodes: [
                        createAgentMessage({
                            id: "assistant-1",
                        }),
                    ],
                }),
                collectThreadCumulativeUsage: async () => null,
            } as unknown as ThreadMessageService,
            liveRuns,
        );

        const snapshot = await service.getThreadSnapshot("thread-1");

        expect(snapshot?.conversationTree.nodes).toHaveLength(1);
        expect(snapshot?.activeRun).toMatchObject({
            threadId: "thread-1",
            text: "输出",
            thinkingText: "思考",
        });
        expect(snapshot?.activeRun?.tools).toHaveLength(1);
    });

    it("轻量 summary 补全只聚合 usage，不加载详情依赖", async () => {
        const loadConversationTree = vi.fn();
        const listSubAgents = vi.fn();
        const listManagingLeaders = vi.fn();
        const collectThreadCumulativeUsage = vi.fn(async () => ({
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            cacheReadTokens: 2,
            cacheMissTokens: 8,
            cacheCreationTokens: 1,
        }));
        const service = new ThreadProjectionService(
            {
                findById: async () => createThreadRecord(),
                listSubAgents,
                listManagingLeaders,
            } as unknown as ThreadRepository,
            {
                loadConversationTree,
                collectThreadCumulativeUsage,
            } as unknown as ThreadMessageService,
            new LiveRunRegistry(),
        );

        const summary = await service.enrichThreadSummary(createThreadSummary({
            usageSummary: {
                lastRun: {
                    inputTokens: 3,
                    outputTokens: 4,
                    totalTokens: 7,
                    cacheReadTokens: null,
                    cacheMissTokens: null,
                    cacheCreationTokens: null,
                },
                cumulative: null,
            },
        }));

        expect(summary.usageSummary).toEqual({
            lastRun: {
                inputTokens: 3,
                outputTokens: 4,
                totalTokens: 7,
                cacheReadTokens: null,
                cacheMissTokens: null,
                cacheCreationTokens: null,
            },
            cumulative: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
                cacheReadTokens: 2,
                cacheMissTokens: 8,
                cacheCreationTokens: 1,
            },
        });
        expect(loadConversationTree).not.toHaveBeenCalled();
        expect(listSubAgents).not.toHaveBeenCalled();
        expect(listManagingLeaders).not.toHaveBeenCalled();
    });
});
