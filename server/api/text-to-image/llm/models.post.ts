import {defineEventHandler} from "h3";
import {z} from "zod";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {fetchLlmModels} from "nbook/server/text-to-image/llm-models";

const ModelsBodySchema = z.object({
    providerId: z.number().int().positive(),
});

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, ModelsBodySchema);
    const runtime = await new TextToImageProviderService().resolveRuntimeProvider(user.id, body.providerId);
    const settings = TextToImageLlmProviderSettingsSchema.parse(runtime.settings);
    const models = await fetchLlmModels({
        baseUrl: settings.baseUrl,
        credential: runtime.credential,
    });
    return {models};
});
