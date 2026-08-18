import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {CharacterVisualLibraryService, GroupNameConflictError} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {validateBody} from "nbook/server/utils/novel-chapter";

// 服务端生成 groupId；浏览器提交 groupId 会被 .strict() 拒绝。
const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().trim().optional(),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, BodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    try {
        return {group: await new CharacterVisualLibraryService().createGroup(projectRoot, {name: body.name, description: body.description})};
    } catch (cause) {
        if (cause instanceof GroupNameConflictError) {
            throw createError({statusCode: 409, message: cause.message});
        }
        throw createError({statusCode: 400, message: cause instanceof Error ? cause.message : "创建角色分组失败"});
    }
});
