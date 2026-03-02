import {requireNovelId} from "nbook/server/utils/novel-chapter";
import {plotFacade, requirePlotId} from "nbook/server/plot";

/**
 * 查询情节点详情。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const plotId = requirePlotId(event);
    return plotFacade.getStoryPlotDto(novelId, plotId);
});
