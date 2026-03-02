import {readClientVariablesHeader, requireThreadId} from "nbook/server/agent/api";
import {toAgentSubagentSummaryDto, useAgentSystem} from "nbook/server/agent/http";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {CreateSubAgentThreadRequestDtoSchema} from "nbook/shared/dto/agent-chat.dto";

/**
 * 创建并挂接新的 subagent。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    const body = await validateBody(event, CreateSubAgentThreadRequestDtoSchema);
    const agentSystem = useAgentSystem();
    const clientVariables = readClientVariablesHeader(event);
    if (clientVariables) {
        await agentSystem.syncClientVariables(threadId, clientVariables);
    }
    const created = await agentSystem.createSubAgentThread({
        leaderThreadId: threadId,
        profileKey: body.profileKey,
        title: body.title,
    });
    const summaries = await agentSystem.listSubAgents(threadId);
    const summary = summaries.find((item) => item.id === created.id);
    if (!summary) {
        throw createError({
            statusCode: 500,
            message: "创建 subagent 后未找到摘要",
        });
    }
    return toAgentSubagentSummaryDto(summary);
});
