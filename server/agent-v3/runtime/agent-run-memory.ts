import {AIMessage, HumanMessage} from "nbook/server/agent-v3/neuro-agent";
import type {AgentMessage} from "nbook/server/agent-v3/neuro-agent";
import type {AgentRunMemorySnapshot} from "nbook/server/agent-v3/runtime/runtime.types";

/**
 * 单线程线性内存。
 */
export class AgentRunMemory {
    private readonly messages: AgentMessage[] = [];

    /**
     * 追加用户输入。
     */
    appendUser(content: string): void {
        this.messages.push(new HumanMessage(content));
    }

    /**
     * 追加 assistant 输出。
     */
    appendAssistant(content: string): void {
        if (!content.trim()) {
            return;
        }
        this.messages.push(new AIMessage(content));
    }

    /**
     * 读取当前消息。
     */
    get snapshot(): AgentRunMemorySnapshot {
        return {
            messages: [...this.messages],
        };
    }
}
