import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {CharacterVisualFileSchema} from "nbook/server/text-to-image/character-visual.codec";
import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {validateBody} from "nbook/server/utils/novel-chapter";

const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    visualId: z.string().uuid().optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
    setActive: z.boolean().optional(),
    visual: CharacterVisualFileSchema,
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, BodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    try {
        return await new CharacterVisualLibraryService().write(projectRoot, body, body.visual, {
            expectedUpdatedAt: body.expectedUpdatedAt,
            setActive: body.setActive,
        });
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : "保存视觉资料失败";
        throw createError({statusCode: message.includes("在生成期间") ? 409 : 400, message});
    }
});
