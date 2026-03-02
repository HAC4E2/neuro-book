import {describe, expect, it} from "vitest";
import {ActiveRunSession, LiveRunRegistry} from "nbook/server/agent/runtime/live-run-registry";
import type {AgentStreamEvent} from "nbook/server/agent/types";

/**
 * 读取下一条事件。
 */
async function nextEvent(stream: AsyncIterable<AgentStreamEvent>): Promise<AgentStreamEvent> {
    const result = await stream[Symbol.asyncIterator]().next();
    if (result.done || !result.value) {
        throw new Error("未收到预期事件");
    }
    return result.value;
}

describe("LiveRunRegistry", () => {
    it("open/get/close 会维护活跃会话", () => {
        const registry = new LiveRunRegistry();
        const session = registry.open("thread-1", "leader.default");

        expect(registry.get("thread-1")).toBe(session);

        registry.close("thread-1");
        expect(registry.get("thread-1")).toBeNull();
    });

    it("同一线程不能重复打开活跃 run", () => {
        const registry = new LiveRunRegistry();
        registry.open("thread-1", "leader.default");

        expect(() => registry.open("thread-1", "leader.default")).toThrow(/已有活跃 run/);
    });
});

describe("ActiveRunSession", () => {
    it("会把累计式 assistant chunk 归一化为真实增量", () => {
        const session = new ActiveRunSession("thread-1", "leader.default");

        expect(session.appendAssistantText("按照你")).toBe("按照你");
        expect(session.appendAssistantText("按照你提供的")).toBe("提供的");
        expect(session.appendAssistantText("提供的模板")).toBe("模板");
        expect(session.snapshot.text).toBe("按照你提供的模板");
    });

    it("会把累计式 thinking chunk 归一化为真实增量", () => {
        const session = new ActiveRunSession("thread-1", "leader.default");

        expect(session.appendThinkingText("第一段思考")).toBe("第一段思考");
        expect(session.appendThinkingText("第一段思考，继续展开")).toBe("，继续展开");
        expect(session.snapshot.thinkingText).toBe("第一段思考，继续展开");
    });

    it("会稳定维护工具节点状态迁移", () => {
        const session = new ActiveRunSession("thread-1", "leader.default");
        const draft = session.ensureToolDraft({
            callIndex: 0,
            toolName: "read_file",
            toolCallId: "call-1",
        });

        session.appendToolArgs(draft.toolNodeId, "{\"filePath\":\"chapter.md\"}");
        session.startToolExecution(draft.toolNodeId, "call-1");
        session.appendToolOutput("call-1", "内容 A");
        const finished = session.finishTool(draft.toolNodeId, "call-1", "最终内容", "success");

        expect(finished).toMatchObject({
            assistantMessageId: session.snapshot.messageId,
            callIndex: 0,
            toolCallId: "call-1",
            status: "success",
            outputText: "最终内容",
        });
        expect(session.getToolNodeId("call-1")).toBe(draft.toolNodeId);
        expect(session.snapshot.tools).toHaveLength(1);
    });

    it("同一 callIndex 只会复用同一个 toolNodeId", () => {
        const session = new ActiveRunSession("thread-1", "leader.default");
        const first = session.ensureToolDraft({
            callIndex: 0,
            toolName: "read_file",
        });
        const second = session.ensureToolDraft({
            callIndex: 0,
            toolName: "read_file",
            toolCallId: "call-2",
        });

        expect(second.toolNodeId).toBe(first.toolNodeId);
        expect(second.toolCallId).toBe("call-2");
    });

    it("相同 callIndex 但 toolCallId 不同时会分配新的 toolNodeId", () => {
        const session = new ActiveRunSession("thread-1", "leader.default");
        const first = session.ensureToolDraft({
            callIndex: 0,
            toolName: "request_user_input",
            toolCallId: "call-1",
        });
        const second = session.ensureToolDraft({
            callIndex: 0,
            toolName: "request_user_input",
            toolCallId: "call-2",
        });

        expect(second.toolNodeId).not.toBe(first.toolNodeId);
        expect(second.callIndex).toBe(1);
        expect(session.snapshot.tools.map((tool) => tool.toolNodeId)).toHaveLength(2);
    });

    it("resetIteration 会清空本轮工具状态并生成新的 assistantMessageId", () => {
        const session = new ActiveRunSession("thread-1", "leader.default");
        const firstMessageId = session.snapshot.messageId;
        const draft = session.ensureToolDraft({
            callIndex: 0,
            toolName: "read_file",
            toolCallId: "call-1",
        });
        session.appendAssistantText("一段回答");
        session.appendThinkingText("一段思考");
        session.appendToolArgs(draft.toolNodeId, "{}");

        session.resetIteration();

        expect(session.snapshot.messageId).not.toBe(firstMessageId);
        expect(session.snapshot.text).toBe("");
        expect(session.snapshot.thinkingText).toBe("");
        expect(session.snapshot.tools).toEqual([]);
        expect(session.getToolNodeId("call-1")).toBeUndefined();
    });

    it("会向多个订阅者广播事件，并在 complete 后结束流", async () => {
        const session = new ActiveRunSession("thread-1", "leader.default");
        const streamA = session.subscribe();
        const streamB = session.subscribe();
        const event: AgentStreamEvent = {
            type: "run_state",
            threadId: "thread-1",
            status: "running",
        };

        session.publish(event);

        await expect(nextEvent(streamA)).resolves.toMatchObject(event);
        await expect(nextEvent(streamB)).resolves.toMatchObject(event);

        session.complete();
        const iterator = streamA[Symbol.asyncIterator]();
        await expect(iterator.next()).resolves.toMatchObject({
            done: true,
        });
    });
});
