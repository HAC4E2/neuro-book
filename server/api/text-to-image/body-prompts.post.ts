import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {generateBodyImageBlocks} from "nbook/server/text-to-image/body-image-llm";
import {insertBodyImagePlaceholders} from "nbook/server/text-to-image/body-image-insert.service";
import {loadEffectiveConfig} from "nbook/server/config/config-service";
import {resolveTextToImageContextEntries} from "nbook/server/text-to-image/llm-context";

const BodyPromptsBodySchema = z.object({
    providerId: z.number().int().positive(),
    chapterContent: z.string().min(1),
    characterSummary: z.string().default(""),
});

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, BodyPromptsBodySchema);
    const runtime = await new TextToImageProviderService().resolveRuntimeProvider(user.id, body.providerId);
    const settings = TextToImageLlmProviderSettingsSchema.parse(runtime.settings);
    const effective = await loadEffectiveConfig({workspaceKind: "user-assets"});
    const profileName = effective.textToImage.currentWordReplacementProfile;
    const profile = effective.textToImage.wordReplacementProfiles[profileName];
    const blocks = await generateBodyImageBlocks({
        provider: {
            baseUrl: settings.baseUrl,
            credential: runtime.credential,
            settings: runtime.settings,
        },
        chapterContent: body.chapterContent,
        characterSummary: body.characterSummary,
        textReplacementRules: profile?.textReplacement ?? "",
        aiReplacementRules: profile?.aiReplacement ?? "",
        contextEntries: await resolveTextToImageContextEntries("image_gen"),
        runtime: {
            body: body.chapterContent,
            context: body.characterSummary,
            userDemand: "",
        },
    });
    const inserted = insertBodyImagePlaceholders({
        chapterContent: body.chapterContent,
        blocks,
    });
    return {blocks, content: inserted.content, placeholders: inserted.placeholders};
});
