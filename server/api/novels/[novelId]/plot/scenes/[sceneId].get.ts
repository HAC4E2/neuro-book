import {requireNovelId} from "nbook/server/utils/novel-chapter";
import {plotFacade, requireSceneId} from "nbook/server/plot";

/**
 * 查询剧情场景详情。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const sceneId = requireSceneId(event);
    return plotFacade.getStorySceneDetailDto(novelId, sceneId);
});
