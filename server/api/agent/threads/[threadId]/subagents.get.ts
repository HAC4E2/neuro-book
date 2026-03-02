import {readClientVariablesHeader, requireThreadId} from "nbook/server/agent/api";
import {toAgentSubagentSummaryDto, useAgentSystem} from "nbook/server/agent/http";

/**
 * 列出 leader 当前关联的 subagent。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    const agentSystem = useAgentSystem();
    const clientVariables = readClientVariablesHeader(event);
    if (clientVariables) {
        await agentSystem.syncClientVariables(threadId, clientVariables);
    }
    const subagents = await agentSystem.listSubAgents(threadId);
    return subagents.map(toAgentSubagentSummaryDto);
});
