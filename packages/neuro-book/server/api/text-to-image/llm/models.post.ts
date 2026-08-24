import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {fetchLlmModels} from "nbook/server/text-to-image/llm-models";

const ModelsBodySchema = z.object({
    providerId: z.number().int().positive().optional(),
    baseUrl: z.string().trim().min(1).optional(),
    credential: z.string().optional(),
});

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, ModelsBodySchema);
    if (body.providerId === undefined && body.baseUrl === undefined) {
        throw createError({statusCode: 400, message: "providerId 或 baseUrl 至少提供一个"});
    }
    let baseUrl: string;
    let credential: string;
    if (body.providerId !== undefined) {
        const runtime = await new TextToImageProviderService().resolveRuntimeProvider(user.id, body.providerId);
        const settings = TextToImageLlmProviderSettingsSchema.parse(runtime.settings);
        baseUrl = settings.baseUrl;
        credential = runtime.credential;
    } else {
        baseUrl = body.baseUrl!;
        credential = body.credential ?? "";
    }
    const models = await fetchLlmModels({
        baseUrl,
        credential,
    });
    return {models};
});
