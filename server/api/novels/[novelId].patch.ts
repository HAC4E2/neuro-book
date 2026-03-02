import {
    UpdateNovelRequestDtoSchema,
    type UpdateNovelRequestDto,
} from "nbook/shared/dto/novel-chapter.dto";
import {assertNovel, requireNovelId, toNovelResponse, validateBody} from "nbook/server/utils/novel-chapter";
import {prisma} from "nbook/server/utils/prisma";

/**
 * 更新小说信息。
 */
export default defineEventHandler(async (event) => {
    const novelId = requireNovelId(event);
    const body = await validateBody<UpdateNovelRequestDto>(event, UpdateNovelRequestDtoSchema);

    await assertNovel(prisma, novelId);

    const novel = await prisma.novel.update({
        where: {id: novelId},
        data: {
            title: body.title,
            summary: body.summary,
        },
    });

    return toNovelResponse(novel);
});
