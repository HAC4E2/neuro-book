import {readClientVariablesHeader, requireThreadId} from "nbook/server/agent/api";
import {useAgentSystem} from "nbook/server/agent/http";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {UpdateAgentPlanModeRequestDtoSchema} from "nbook/shared/dto/agent-chat.dto";

/**
 * 切换 thread 级软 Plan Mode。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    const body = await validateBody(event, UpdateAgentPlanModeRequestDtoSchema);
    const agentSystem = useAgentSystem();
    const clientVariables = readClientVariablesHeader(event);
    if (clientVariables) {
        await agentSystem.syncClientVariables(threadId, clientVariables);
    }
    if (body.active) {
        await agentSystem.enterPlanMode(threadId);
    } else {
        await agentSystem.exitPlanMode(threadId);
    }
    return {ok: true};
});
