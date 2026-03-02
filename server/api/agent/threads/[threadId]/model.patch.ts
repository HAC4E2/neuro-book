import {toAgentThreadSummaryDto, useAgentSystem} from "nbook/server/agent/http";
import {UpdateAgentThreadModelRequestDtoSchema, type AgentThreadSummaryDto, type UpdateAgentThreadModelRequestDto} from "nbook/shared/dto/agent-chat.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 更新线程模型覆盖。
 */
export default defineEventHandler(async (event): Promise<AgentThreadSummaryDto> => {
    const threadId = getRouterParam(event, "threadId");
    if (!threadId) {
        throw createError({
            statusCode: 400,
            message: "threadId 不能为空",
        });
    }

    const body = await validateBody<UpdateAgentThreadModelRequestDto>(event, UpdateAgentThreadModelRequestDtoSchema);
    const agentSystem = useAgentSystem();
    const summary = body.mode === "default"
        ? await agentSystem.updateThreadModelOverride(threadId, null)
        : body.mode === "override" && body.config
            ? await agentSystem.updateThreadModelOverride(threadId, body.config)
            : await agentSystem.updateThreadModelOverride(threadId, null, body.modelKey ?? null);
    return toAgentThreadSummaryDto(summary);
});
