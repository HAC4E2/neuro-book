import {requireThreadId} from "nbook/server/agent/api";
import {useAgentSystem} from "nbook/server/agent/http";

/**
 * 删除 Agent 线程。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    const agentSystem = useAgentSystem();
    await agentSystem.deleteThread(threadId);
    return {
        ok: true,
    };
});
