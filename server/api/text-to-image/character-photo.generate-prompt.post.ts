import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {generateCharacterPhotoPrompt} from "nbook/server/text-to-image/character-photo-llm";

const CharacterPhotoGeneratePromptBodySchema = z.object({
    providerId: z.number().int().positive(),
    characterText: z.string().default(""),
    outfitText: z.string().default(""),
    userRequirement: z.string().default(""),
});

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, CharacterPhotoGeneratePromptBodySchema);
    const runtime = await new TextToImageProviderService().resolveRuntimeProvider(user.id, body.providerId);
    const settings = TextToImageLlmProviderSettingsSchema.parse(runtime.settings);
    const prompt = await generateCharacterPhotoPrompt({
        provider: {
            baseUrl: settings.baseUrl,
            credential: runtime.credential,
            settings: runtime.settings,
        },
        characterText: body.characterText,
        outfitText: body.outfitText,
        userRequirement: body.userRequirement,
    });
    return {prompt};
});
