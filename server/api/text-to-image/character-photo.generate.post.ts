import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {generateCharacterAvatar} from "nbook/server/text-to-image/character-photo.service";
import {CharacterVisualRevisionConflictError} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveBoundTextToImageLlmRuntime} from "nbook/server/text-to-image/llm-runtime";

const CharacterPhotoGenerateBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    visualId: z.string().uuid(),
    characterText: z.string().default(""),
    outfitText: z.string().default(""),
    userRequirement: z.string().default(""),
}).strict();

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, CharacterPhotoGenerateBodySchema);
    const llmRuntime = await resolveBoundTextToImageLlmRuntime(user.id, "char_display");
    try {
        return await generateCharacterAvatar({
            userId: user.id,
            llmRuntime,
            projectRoot: body.projectRoot,
            groupId: body.groupId,
            characterId: body.characterId,
            visualId: body.visualId,
            characterText: body.characterText,
            outfitText: body.outfitText,
            userRequirement: body.userRequirement,
        });
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : "角色照片生成失败";
        throw createError({
            statusCode: cause instanceof CharacterVisualRevisionConflictError ? 409 : message.includes("HTTP 429") ? 429 : 502,
            message,
        });
    }
});
