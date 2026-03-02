import {
    ReorderStoryScenesRequestDtoSchema,
    type ReorderStoryScenesRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 批量重排剧情场景。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const body = await validateBody<ReorderStoryScenesRequestDto>(event, ReorderStoryScenesRequestDtoSchema);
    return plotFacade.reorderStoryScenes(novelId, body);
});
