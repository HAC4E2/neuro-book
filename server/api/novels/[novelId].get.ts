import {assertNovel, requireNovelId, toNovelResponse} from "nbook/server/utils/novel-chapter";
import {prisma} from "nbook/server/utils/prisma";

/**
 * 查询单本小说。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    return toNovelResponse(await assertNovel(prisma, novelId));
});
