import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {
    CharacterVisualLibraryService,
    GroupNameConflictError,
} from "nbook/server/text-to-image/character-visual-library.service";
import {GroupMigrationRevisionConflictError} from "nbook/server/text-to-image/character-group-migration";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {validateBody} from "nbook/server/utils/novel-chapter";

const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    expectedRevision: z.string().trim().min(1),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, BodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    try {
        return await new CharacterVisualLibraryService().deleteGroupWithMigration(projectRoot, body.groupId, body.expectedRevision);
    } catch (cause) {
        if (cause instanceof GroupMigrationRevisionConflictError) {
            throw createError({statusCode: 409, message: cause.message});
        }
        if (cause instanceof GroupNameConflictError) {
            throw createError({statusCode: 409, message: cause.message});
        }
        throw createError({statusCode: 400, message: cause instanceof Error ? cause.message : "删除角色分组失败"});
    }
});
