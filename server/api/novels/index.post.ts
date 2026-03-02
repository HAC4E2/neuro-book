import {randomUUID} from "node:crypto";
import {
    CreateNovelRequestDtoSchema,
    type CreateNovelRequestDto,
} from "nbook/shared/dto/novel-chapter.dto";
import {toNovelResponse, validateBody} from "nbook/server/utils/novel-chapter";
import {prisma} from "nbook/server/utils/prisma";
import {buildNovelIdWorkspaceSlug, writeNovelWorkspaceMetadata} from "nbook/server/workspace-files/novel-workspace";

/**
 * 新建小说。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody<CreateNovelRequestDto>(event, CreateNovelRequestDtoSchema);

    const novel = await prisma.$transaction(async (transactionClient) => {
        const createdNovel = await transactionClient.novel.create({
            data: {
                title: body.title,
                summary: body.summary ?? "",
                workspaceSlug: `novel-pending-${randomUUID()}`,
            },
        });
        const novelWithWorkspace = await transactionClient.novel.update({
            where: {id: createdNovel.id},
            data: {workspaceSlug: buildNovelIdWorkspaceSlug(createdNovel.id)},
        });

        await transactionClient.story.create({
            data: {
                novelId: createdNovel.id,
                title: novelWithWorkspace.title,
                summary: novelWithWorkspace.summary,
            },
        });

        return novelWithWorkspace;
    });

    await writeNovelWorkspaceMetadata(novel);
    return toNovelResponse(novel);
});
