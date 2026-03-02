import {z} from "zod";
import type {AgentTool, AgentToolContext} from "nbook/server/agent-v3/tool/tool.types";
import type {JsonObject} from "nbook/server/agent-v3/runtime/runtime.types";

export type AgentToolDefinition = {
    key: string;
    description: string;
    parameters: JsonObject;
};

/**
 * 可被 NeuroAgent 执行的工具实例。
 */
export class NeuroAgentTool<TSchema extends z.ZodType = z.ZodType> {
    constructor(
        readonly definition: AgentTool<TSchema>,
        private readonly context: AgentToolContext,
    ) {}

    /**
     * 输出模型可读的工具定义。
     */
    get schema(): AgentToolDefinition {
        return {
            key: this.definition.key,
            description: this.definition.description,
            parameters: z.toJSONSchema(this.definition.schema) as JsonObject,
        };
    }

    /**
     * 解析并执行工具。
     */
    async execute(argsText: string): Promise<string> {
        const input = argsText.trim() ? JSON.parse(argsText) as unknown : {};
        const result = await this.definition.execute(this.definition.schema.parse(input), this.context);
        return result.content;
    }
}
