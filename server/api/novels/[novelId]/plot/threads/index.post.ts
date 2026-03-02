import {
    CreateStoryThreadRequestDtoSchema,
    type CreateStoryThreadRequestDto,
} from "nbook/shared/dto/plot.dto";
import {plotFacade} from "nbook/server/plot";
import {requireNovelId, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 新建剧情线程。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const body = await validateBody<CreateStoryThreadRequestDto>(event, CreateStoryThreadRequestDtoSchema);
    return plotFacade.createStoryThread(novelId, body);
});
