import {
    UpdateStorySceneRequestDtoSchema,
    type UpdateStorySceneRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade, requireSceneId} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 更新剧情场景。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const sceneId = requireSceneId(event);
    const body = await validateBody<UpdateStorySceneRequestDto>(event, UpdateStorySceneRequestDtoSchema);
    return plotFacade.updateStoryScene(novelId, sceneId, body);
});
