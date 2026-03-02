import {
    CreateStoryPlotRequestDtoSchema,
    type CreateStoryPlotRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 新建情节点。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const body = await validateBody<CreateStoryPlotRequestDto>(event, CreateStoryPlotRequestDtoSchema);
    return plotFacade.createStoryPlot(novelId, body);
});
