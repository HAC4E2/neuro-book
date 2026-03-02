import type {AgentTool, AgentToolContext} from "nbook/server/agent-v3/tool/tool.types";
import {NeuroAgentTool} from "nbook/server/agent-v3/neuro-agent";

/**
 * Agent 工具注册表。
 */
export class AgentToolRegistry {
    private readonly tools = new Map<string, AgentTool>();

    /**
     * 注册工具。
     */
    register(toolDefinition: AgentTool): void {
        if (this.tools.has(toolDefinition.key)) {
            throw new Error(`重复的 tool key: ${toolDefinition.key}`);
        }
        this.tools.set(toolDefinition.key, toolDefinition);
    }

    /**
     * 读取工具定义。
     */
    get(key: string): AgentTool {
        const toolDefinition = this.tools.get(key);
        if (!toolDefinition) {
            throw new Error(`未知的 tool key: ${key}`);
        }
        return toolDefinition;
    }

    /**
     * 列出工具 key。
     */
    listKeys(): string[] {
        return [...this.tools.keys()];
    }

    /**
     * 解析为 NeuroAgent tools。
     */
    toAgentTools(context: AgentToolContext): NeuroAgentTool[] {
        return [...this.tools.values()].map((toolDefinition) => new NeuroAgentTool(toolDefinition, context));
    }
}
