import {createError} from "h3";
import {requireMessageId, requireThreadId} from "nbook/server/agent/api";
import {toAgentConversationTreeSnapshotDto, useAgentSystem} from "nbook/server/agent/http";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {UpdateAgentMessageRequestDtoSchema} from "nbook/shared/dto/agent-chat.dto";

/**
 * 改写指定历史消息，并返回最新历史树快照。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    const messageId = requireMessageId(event);

    const body = await validateBody(event, UpdateAgentMessageRequestDtoSchema);
    const agentSystem = useAgentSystem();
    await agentSystem.updateThreadMessage(threadId, messageId, body.content);
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
