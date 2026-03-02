import {requireNovelId} from "nbook/server/utils/novel-chapter";
import {plotFacade, requireStoryThreadId} from "nbook/server/plot";

/**
 * 查询剧情线程详情。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const threadId = requireStoryThreadId(event);
    return plotFacade.getStoryThreadDetailDto(novelId, threadId);
});
