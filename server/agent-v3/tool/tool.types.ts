import type {z} from "zod";
import type {JsonValue} from "nbook/server/agent-v3/runtime/runtime.types";

/**
 * 工具执行上下文。
 */
export type AgentToolContext = {
    /**
     * 当前工具输出增量。
     */
    writeOutput(chunk: string): void;
};

/**
 * 工具执行结果。
 */
export type AgentToolResult = {
    content: string;
    rawResult?: JsonValue;
};

/**
 * v3 工具定义。
 */
export interface AgentTool<TSchema extends z.ZodType = z.ZodType> {
    readonly key: string;
    readonly description: string;
    readonly schema: TSchema;

    /**
     * 执行工具。
     */
    execute(input: z.infer<TSchema>, context: AgentToolContext): Promise<AgentToolResult>;
}
