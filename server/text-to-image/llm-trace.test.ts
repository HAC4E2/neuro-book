import {describe, expect, it} from "vitest";
import {textToImageLlmTraceHub} from "nbook/server/text-to-image/llm-trace";

describe("llm trace hub", () => {
    it("订阅在请求开始前建立也能收到流式事件", () => {
        const userId = Math.floor(Math.random() * 1_000_000) + 1;
        const events: string[] = [];
        const unsubscribe = textToImageLlmTraceHub.subscribe(userId, (event) => {
            events.push(`${event.kind}:${event.content ?? ""}`);
        });
        const trace = textToImageLlmTraceHub.start(userId, {requestType: "char_design", model: "test-model"});
        trace.delta("part-1", 1);
        trace.delta("part-2", 1);
        trace.completed("part-1part-2", 1);
        unsubscribe();

        expect(events).toEqual([
            "started:",
            "delta:part-1",
            "delta:part-1part-2",
            "completed:part-1part-2",
        ]);
    });

    it("旧请求完成后不会覆盖同一用户的新请求", () => {
        const userId = Math.floor(Math.random() * 1_000_000) + 1;
        const first = textToImageLlmTraceHub.start(userId, {requestType: "char_design", model: "first"});
        const second = textToImageLlmTraceHub.start(userId, {requestType: "char_modify", model: "second"});
        first.completed("stale", 1);
        second.completed("fresh", 1);

        expect(textToImageLlmTraceHub.getLatest(userId)).toMatchObject({
            traceId: second.traceId,
            model: "second",
            content: "fresh",
        });
    });
});
