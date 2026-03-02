import {
    ReorderStoryPlotsRequestDtoSchema,
    type ReorderStoryPlotsRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 批量重排情节点。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const body = await validateBody<ReorderStoryPlotsRequestDto>(event, ReorderStoryPlotsRequestDtoSchema);
    return plotFacade.reorderStoryPlots(novelId, body);
});
