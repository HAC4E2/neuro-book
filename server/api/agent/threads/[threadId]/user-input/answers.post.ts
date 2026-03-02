import {readClientVariablesHeader, requireThreadId} from "nbook/server/agent/api";
import {useAgentSystem} from "nbook/server/agent/http";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {SubmitUserInputAnswersRequestDtoSchema} from "nbook/shared/dto/agent-chat.dto";

/**
 * 提交 request_user_input 的答案。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    const body = await validateBody(event, SubmitUserInputAnswersRequestDtoSchema);
    const agentSystem = useAgentSystem();
    const clientVariables = readClientVariablesHeader(event);
    if (clientVariables) {
        await agentSystem.syncClientVariables(threadId, clientVariables);
    }
    await agentSystem.submitUserInputAnswers(threadId, body);
    return {ok: true};
});
