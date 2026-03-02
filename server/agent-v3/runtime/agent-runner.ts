import type {ChatModel} from "nbook/server/agent-v3/neuro-agent";
import {createAgent} from "nbook/server/agent-v3/neuro-agent";
import {chatModel} from "nbook/server/agent-v3/model-provider/model-provider";
import {AgentRunMemory} from "nbook/server/agent-v3/runtime/agent-run-memory";
import type {AgentRunEvent, AgentRunInput} from "nbook/server/agent-v3/runtime/runtime.types";
import type {AgentToolRegistry} from "nbook/server/agent-v3/tool/tool-registry";

/**
 * 运行一个内存态 Agent loop。
 */
export class AgentRunner {
    constructor(
        private readonly toolRegistry: AgentToolRegistry,
        private readonly memory = new AgentRunMemory(),
        private readonly model: ChatModel = chatModel,
    ) {}

    /**
     * 执行一次用户输入，并流式返回 v3 事件。
     */
    async *run(input: AgentRunInput): AsyncGenerator<AgentRunEvent> {
        this.memory.appendUser(input.prompt);
        const agent = createAgent({
            model: this.model,
            tools: this.toolRegistry.toAgentTools({
                writeOutput() {},
            }),
        });

        for await (const event of agent.stream({
            messages: this.memory.snapshot.messages,
            signal: input.signal,
        })) {
            if (event.type === "done") {
                this.memory.appendAssistant(event.messageText);
                yield {
                    type: "done",
                    messageText: event.messageText,
                };
                continue;
            }
            yield event;
        }
    }
}
