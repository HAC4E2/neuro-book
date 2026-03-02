import {
    ReorderStoryThreadsRequestDtoSchema,
    type ReorderStoryThreadsRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 批量重排剧情线程。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const body = await validateBody<ReorderStoryThreadsRequestDto>(event, ReorderStoryThreadsRequestDtoSchema);
    return plotFacade.reorderStoryThreads(novelId, body);
});
