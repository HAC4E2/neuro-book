import {requireNovelId} from "nbook/server/utils/novel-chapter";
import {plotFacade, requireStoryThreadId} from "nbook/server/plot";

/**
 * 删除剧情线程。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const threadId = requireStoryThreadId(event);
    await plotFacade.deleteStoryThread(novelId, threadId);
    return {success: true};
});
