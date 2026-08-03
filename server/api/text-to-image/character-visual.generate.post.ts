import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {
    readCharacterVisual,
    writeCharacterVisual,
} from "nbook/server/text-to-image/character-visual.service";
import {generateCharacterVisualDraft} from "nbook/server/text-to-image/character-visual-llm";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const CharacterVisualGenerateBodySchema = z.object({
    providerId: z.number().int().positive(),
    projectRoot: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    characterPage: z.string().trim().min(1),
    mode: z.enum(["fill_empty", "replace_visual"]),
});

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, CharacterVisualGenerateBodySchema);
    const runtime = await new TextToImageProviderService().resolveRuntimeProvider(user.id, body.providerId);
    const settings = TextToImageLlmProviderSettingsSchema.parse(runtime.settings);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    const existing = await readCharacterVisual(projectRoot, body.characterId);
    const visual = await generateCharacterVisualDraft({
        provider: {
            baseUrl: settings.baseUrl,
            credential: runtime.credential,
            settings: runtime.settings,
        },
        characterId: body.characterId,
        characterPage: body.characterPage,
        existingSummary: existing ? JSON.stringify(existing) : "",
        mode: body.mode,
    });
    await writeCharacterVisual(projectRoot, body.characterId, visual);
    return {visual};
});
