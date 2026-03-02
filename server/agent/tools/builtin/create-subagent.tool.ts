import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";

const CreateSubagentInputSchema = z.object({
    profileKey: z.enum(["subagent.writer", "subagent.retrieval"]).describe("The subagent profile to use. \"subagent.writer\" writes prose and \"subagent.retrieval\" selects content nodes for downstream profiles."),
    title: z.string().trim().min(1, "title 不能为空").optional().describe("Optional display title for the subagent thread."),
});

/**
 * 创建 subagent 的内建工具。
 */
export const createSubagentTool: AgentTool<typeof CreateSubagentInputSchema> = {
    key: "create_subagent",
    description: "Create a new subagent thread and attach it to the current leader. The subagent must be invoked separately via invoke_subagent to run.",
    schema: CreateSubagentInputSchema,
    async execute(input, context) {
        const created = await context.agentGateway.createSubAgentThread({
            leaderThreadId: context.threadId,
            profileKey: input.profileKey,
            title: input.title,
        });

        const rawResult = {
            subagentThreadId: created.id,
            profileKey: created.profileKey,
            title: created.title,
        };
        return {
            ...createToolResultMessage(`Subagent created: ${created.id}`, JSON.stringify(input)),
            rawResult,
        };
    },
};
