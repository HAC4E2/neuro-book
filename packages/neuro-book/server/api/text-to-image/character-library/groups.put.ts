import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {CharacterVisualLibraryService, GroupNameConflictError} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {validateBody} from "nbook/server/utils/novel-chapter";

const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    name: z.string().trim().optional(),
    description: z.string().trim().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, BodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    try {
        return {group: await new CharacterVisualLibraryService().updateGroup(projectRoot, body.groupId, body)};
    } catch (cause) {
        if (cause instanceof GroupNameConflictError) {
            throw createError({statusCode: 409, message: cause.message});
        }
        throw createError({statusCode: 400, message: cause instanceof Error ? cause.message : "更新角色分组失败"});
    }
});
