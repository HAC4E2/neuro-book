import {
    CreateStorySceneRequestDtoSchema,
    type CreateStorySceneRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 新建剧情场景。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const body = await validateBody<CreateStorySceneRequestDto>(event, CreateStorySceneRequestDtoSchema);
    return plotFacade.createStoryScene(novelId, body);
});
