import type {AgentRunEvent} from "nbook/server/agent-v3/runtime/runtime.types";

/**
 * v3 事件透传器。
 * 旧版这里负责消费 LangChain stream events；NeuroAgent 已直接产出 v3 事件。
 */
export class StreamEventConsumer {
    /**
     * 透传 NeuroAgent 事件，并把异常转换为 error 事件。
     */
    async *consume(events: AsyncIterable<AgentRunEvent>): AsyncGenerator<AgentRunEvent> {
        try {
            for await (const event of events) {
                yield event;
            }
        } catch (error) {
            yield {
                type: "error",
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
