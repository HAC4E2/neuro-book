import {readClientVariablesHeader, requireThreadId} from "nbook/server/agent/api";
import {useAgentSystem} from "nbook/server/agent/http";

/**
 * 中止当前线程的活跃运行。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    const agentSystem = useAgentSystem();
    const clientVariables = readClientVariablesHeader(event);
    if (clientVariables) {
        await agentSystem.syncClientVariables(threadId, clientVariables);
    }

    await agentSystem.stopThreadRun(threadId);
    return {ok: true};
});
