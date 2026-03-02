import {requireNovelId} from "nbook/server/utils/novel-chapter";
import {plotFacade, requirePhaseId} from "nbook/server/plot";

/**
 * 删除剧情阶段。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const phaseId = requirePhaseId(event);
    await plotFacade.deleteStoryPhase(novelId, phaseId);
    return {success: true};
});
