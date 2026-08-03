import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {generateCharacterAvatar} from "nbook/server/text-to-image/character-photo.service";

const CharacterPhotoGenerateBodySchema = z.object({
    llmProviderId: z.number().int().positive(),
    novelAiProviderId: z.number().int().positive(),
    projectRoot: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    characterText: z.string().default(""),
    outfitText: z.string().default(""),
    userRequirement: z.string().default(""),
});

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, CharacterPhotoGenerateBodySchema);
    return await generateCharacterAvatar({
        userId: user.id,
        llmProviderId: body.llmProviderId,
        novelAiProviderId: body.novelAiProviderId,
        projectRoot: body.projectRoot,
        characterId: body.characterId,
        characterText: body.characterText,
        outfitText: body.outfitText,
        userRequirement: body.userRequirement,
    });
});
