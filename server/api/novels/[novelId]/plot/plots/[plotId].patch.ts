import {
    UpdateStoryPlotRequestDtoSchema,
    type UpdateStoryPlotRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade, requirePlotId} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 更新情节点。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const plotId = requirePlotId(event);
    const body = await validateBody<UpdateStoryPlotRequestDto>(event, UpdateStoryPlotRequestDtoSchema);
    return plotFacade.updateStoryPlot(novelId, plotId, body);
});
