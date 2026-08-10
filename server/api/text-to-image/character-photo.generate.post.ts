import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {generateCharacterAvatar} from "nbook/server/text-to-image/character-photo.service";
import {resolveTextToImageRequestProvider} from "nbook/server/text-to-image/llm-context";

const CharacterPhotoGenerateBodySchema = z.object({
    novelAiProviderId: z.number().int().positive(),
    projectRoot: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    groupId: z.string().trim().min(1).optional(),
    characterText: z.string().default(""),
    outfitText: z.string().default(""),
    userRequirement: z.string().default(""),
});

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, CharacterPhotoGenerateBodySchema);
    const llmProvider = await resolveTextToImageRequestProvider(user.id, "char_display");
    try {
        return await generateCharacterAvatar({
            userId: user.id,
            llmProviderId: llmProvider.providerId,
            novelAiProviderId: body.novelAiProviderId,
            projectRoot: body.projectRoot,
            characterId: body.characterId,
            groupId: body.groupId,
            characterText: body.characterText,
            outfitText: body.outfitText,
            userRequirement: body.userRequirement,
        });
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : "角色照片生成失败";
        throw createError({statusCode: message.includes("HTTP 429") ? 429 : 502, message});
    }
});
