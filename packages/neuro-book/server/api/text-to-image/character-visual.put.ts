import {defineEventHandler} from "h3";
import {z} from "zod";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {CharacterVisualFileSchema} from "nbook/server/text-to-image/character-visual.codec";
import {TriggerWordFormatError} from "nbook/server/text-to-image/character-trigger-words";
import {writeCharacterVisual} from "nbook/server/text-to-image/character-visual.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const PutBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    visual: CharacterVisualFileSchema,
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, PutBodySchema);
    const parsed = CharacterVisualFileSchema.parse(body.visual);
    try {
        await writeCharacterVisual(
            resolveTextToImageProjectRoot(body.projectRoot),
            body.characterId,
            parsed,
        );
    } catch (cause) {
        if (cause instanceof TriggerWordFormatError) {
            throw createError({statusCode: 400, message: cause.message});
        }
        throw cause;
    }
    return {visual: parsed};
});
