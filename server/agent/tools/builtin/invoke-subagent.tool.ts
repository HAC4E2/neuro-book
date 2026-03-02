import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {RetrievalInputSchema, WriterInputSchema} from "nbook/server/agent/types";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";

const InvokeSubagentInputSchema = z.object({
    subagentThreadId: z.string().trim().min(1, "subagentThreadId 不能为空").describe("The thread ID of the subagent to invoke. Must be an attached subagent of the current leader thread."),
    input: z.union([WriterInputSchema, RetrievalInputSchema]).describe("The input payload for the subagent. Structure depends on the subagent's profile (writer or retrieval)."),
});

/**
 * 调用 subagent 的内建工具。
 * 成功时返回 subagent 的最终结果与可选结构化 data，不把中间 live 消息嵌回 leader thread。
 */
export const invokeSubagentTool: AgentTool<typeof InvokeSubagentInputSchema> = {
    key: "invoke_subagent",
    description: "Invoke an attached subagent and wait for it to complete. Returns the subagent's final result and optional structured data. Intermediate live messages are not embedded back into the leader thread.",
    schema: InvokeSubagentInputSchema,
    async execute(input, context) {
        const result = await context.agentGateway.runSubAgent(
            context.threadId,
            input.subagentThreadId,
            input.input,
            context.runOptions,
        );
        return createToolResultMessage(result, JSON.stringify(input));
    },
};
