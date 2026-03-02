import {createError} from "h3";
import {requireThreadId} from "nbook/server/agent/api";
import {toAgentConversationTreeSnapshotDto, useAgentSystem} from "nbook/server/agent/http";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {CreateAgentMessageRequestDtoSchema} from "nbook/shared/dto/agent-chat.dto";

/**
 * 创建新的用户消息节点，并返回最新历史树快照。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    const body = await validateBody(event, CreateAgentMessageRequestDtoSchema);

    const agentSystem = useAgentSystem();
    await agentSystem.createThreadMessage(threadId, body.content);
    const detail = await agentSystem.getThreadDetailProjection(threadId);
    if (!detail) {
        throw createError({
            statusCode: 404,
            message: "线程不存在",
        });
    }
    return {
        ok: true,
        conversationTree: toAgentConversationTreeSnapshotDto(detail.conversationTree),
    };
});
