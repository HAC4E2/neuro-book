import {readClientVariablesHeader, requireThreadId} from "nbook/server/agent/api";
import {useAgentSystem} from "nbook/server/agent/http";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {DispatchAgentRunRequestDtoSchema} from "nbook/shared/dto/agent-chat.dto";

/**
 * 统一 thread 写入口。
 * leader/subagent 都通过该接口触发一次新的运行。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    try {
        const body = await validateBody(event, DispatchAgentRunRequestDtoSchema);
        const agentSystem = useAgentSystem();
        const clientVariables = readClientVariablesHeader(event);
        if (clientVariables) {
            await agentSystem.syncClientVariables(threadId, clientVariables);
        }
        await agentSystem.dispatchThreadRunById(
            threadId,
            body.mode === "continue"
                ? {mode: "continue"}
                : body.input ?? {},
            body.options ?? {},
        );
        return {ok: true};
    } catch (error) {
        console.error("[agent] invoke post failed", {
            threadId,
        }, error);
        throw error;
    }
});
