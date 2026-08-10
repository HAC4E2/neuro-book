import {defineEventHandler} from "h3";
import {z} from "zod";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {CharacterVisualFileSchema} from "nbook/server/text-to-image/character-visual.codec";
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
    await writeCharacterVisual(
        resolveTextToImageProjectRoot(body.projectRoot),
        body.characterId,
        parsed,
    );
    return {visual: parsed};
});
