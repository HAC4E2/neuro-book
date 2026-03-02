import {requireNovelId} from "nbook/server/utils/novel-chapter";
import {plotFacade, requirePhaseId} from "nbook/server/plot";

/**
 * 查询剧情阶段详情。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const phaseId = requirePhaseId(event);
    return plotFacade.getStoryPhaseDto(novelId, phaseId);
});
