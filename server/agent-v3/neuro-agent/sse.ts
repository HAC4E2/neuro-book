import type {NeuroAgentEvent} from "nbook/server/agent-v3/neuro-agent/agent";

/**
 * 把 NeuroAgent 事件流转换为 text/event-stream。
 */
export function toSseStream(events: AsyncIterable<NeuroAgentEvent>): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const iterator = events[Symbol.asyncIterator]();

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const result = await iterator.next();
            if (result.done) {
                controller.close();
                return;
            }
            controller.enqueue(encoder.encode(renderSseEvent(result.value)));
        },
        async cancel() {
            await iterator.return?.();
        },
    });
}

/**
 * 渲染单个 SSE 帧。
 */
function renderSseEvent(event: NeuroAgentEvent): string {
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
