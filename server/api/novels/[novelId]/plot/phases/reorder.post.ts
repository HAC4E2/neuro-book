import {
    ReorderStoryPhasesRequestDtoSchema,
    type ReorderStoryPhasesRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 批量重排剧情阶段。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const body = await validateBody<ReorderStoryPhasesRequestDto>(event, ReorderStoryPhasesRequestDtoSchema);
    return plotFacade.reorderStoryPhases(novelId, body);
});
