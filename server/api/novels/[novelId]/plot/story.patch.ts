import {
    UpdateStoryRequestDtoSchema,
    type UpdateStoryRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 更新 Story 基本信息。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const body = await validateBody<UpdateStoryRequestDto>(event, UpdateStoryRequestDtoSchema);
    return plotFacade.updateStory(novelId, body);
});
