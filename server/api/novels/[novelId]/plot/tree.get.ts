import {requireNovelId} from "nbook/server/utils/novel-chapter";
import {plotFacade} from "nbook/server/plot";

/**
 * 查询剧情树。
 */
export default defineEventHandler(async (event) => {
    return plotFacade.getPlotTree(requireNovelId(event));
});
