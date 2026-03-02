import {
    UpdateStoryPhaseRequestDtoSchema,
    type UpdateStoryPhaseRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade, requirePhaseId} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 更新剧情阶段。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const phaseId = requirePhaseId(event);
    const body = await validateBody<UpdateStoryPhaseRequestDto>(event, UpdateStoryPhaseRequestDtoSchema);
    return plotFacade.updateStoryPhase(novelId, phaseId, body);
});
