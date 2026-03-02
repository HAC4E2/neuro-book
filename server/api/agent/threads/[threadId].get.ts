import {readClientVariablesHeader, requireThreadId} from "nbook/server/agent/api";
import {toAgentThreadDetailDto, useAgentSystem} from "nbook/server/agent/http";

/**
 * 查询单个 Agent 线程详情。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    const agentSystem = useAgentSystem();
    const clientVariables = readClientVariablesHeader(event);
    if (clientVariables) {
        await agentSystem.syncClientVariables(threadId, clientVariables);
    }
    const detail = await agentSystem.getThreadDetailProjection(threadId);
    if (!detail) {
        throw createError({
            statusCode: 404,
            message: "线程不存在",
        });
    }
    return toAgentThreadDetailDto(detail);
});
