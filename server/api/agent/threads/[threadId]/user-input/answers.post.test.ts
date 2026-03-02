import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/agent/threads/[threadId]/user-input/answers", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("会同步 client variables 并提交答案", async () => {
        const agentSystem = {
            syncClientVariables: vi.fn(async () => {}),
            submitUserInputAnswers: vi.fn(async () => undefined),
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
                assistantMessageId: "assistant-1",
                answers: [{
                    toolNodeId: "tool-1",
                    selectedOptionId: "write_code",
                    note: "先推进实现",
                }],
            })),
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId]/user-input/answers.post")).default;
        const result = await handler({} as never);

        expect(agentSystem.syncClientVariables).toHaveBeenCalledWith("thread-1", {studio: {novelId: "1"}});
        expect(agentSystem.submitUserInputAnswers).toHaveBeenCalledWith("thread-1", {
            assistantMessageId: "assistant-1",
            answers: [{
                toolNodeId: "tool-1",
                selectedOptionId: "write_code",
                note: "先推进实现",
            }],
        });
        expect(result).toEqual({ok: true});
    });
});
