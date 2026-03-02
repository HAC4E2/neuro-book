import {assertNovel, requireNovelId} from "nbook/server/utils/novel-chapter";
import {prisma} from "nbook/server/utils/prisma";

/**
 * 删除整本小说。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    await assertNovel(prisma, novelId);

    await prisma.novel.delete({
        where: {id: novelId},
    });

    return {
        success: true,
    };
});
