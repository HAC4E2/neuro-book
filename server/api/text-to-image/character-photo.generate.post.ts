import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {generateCharacterAvatar} from "nbook/server/text-to-image/character-photo.service";
import {resolveBoundTextToImageLlmRuntime} from "nbook/server/text-to-image/llm-runtime";

const CharacterPhotoGenerateBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
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
            characterId: body.characterId,
            characterText: body.characterText,
            outfitText: body.outfitText,
            userRequirement: body.userRequirement,
        });
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : "角色照片生成失败";
        throw createError({statusCode: message.includes("HTTP 429") ? 429 : 502, message});
    }
});
