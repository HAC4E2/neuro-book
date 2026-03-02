import {createError} from "h3";
import {requireMessageId, requireThreadId} from "nbook/server/agent/api";
import {toAgentConversationTreeSnapshotDto, useAgentSystem} from "nbook/server/agent/http";

/**
 * 激活指定 continuation 节点，并返回最新历史树快照。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    const messageId = requireMessageId(event);

    const agentSystem = useAgentSystem();
    await agentSystem.activateThreadMessage(threadId, messageId);
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
