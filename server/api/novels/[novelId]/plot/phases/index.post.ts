import {
    CreateStoryPhaseRequestDtoSchema,
    type CreateStoryPhaseRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 新建剧情阶段。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const body = await validateBody<CreateStoryPhaseRequestDto>(event, CreateStoryPhaseRequestDtoSchema);
    return plotFacade.createStoryPhase(novelId, body);
});
