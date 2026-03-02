import {
    UpdateStoryThreadRequestDtoSchema,
    type UpdateStoryThreadRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade, requireStoryThreadId} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 更新剧情线程。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const threadId = requireStoryThreadId(event);
    const body = await validateBody<UpdateStoryThreadRequestDto>(event, UpdateStoryThreadRequestDtoSchema);
    return plotFacade.updateStoryThread(novelId, threadId, body);
});
