import {requireNovelId} from "nbook/server/utils/novel-chapter";
import {plotFacade, requireSceneId} from "nbook/server/plot";

/**
 * 删除剧情场景。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const sceneId = requireSceneId(event);
    await plotFacade.deleteStoryScene(novelId, sceneId);
    return {success: true};
});
