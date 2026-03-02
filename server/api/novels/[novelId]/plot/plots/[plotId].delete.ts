import {requireNovelId} from "nbook/server/utils/novel-chapter";
import {plotFacade, requirePlotId} from "nbook/server/plot";

/**
 * 删除情节点。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const plotId = requirePlotId(event);
    await plotFacade.deleteStoryPlot(novelId, plotId);
    return {success: true};
});
