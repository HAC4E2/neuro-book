import {createError} from "h3";
import {listTextToImageLlmModels} from "nbook/server/text-to-image/llm-provider";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageProviderIdSchema} from "nbook/server/text-to-image/schemas";
import {requireCurrentUser} from "nbook/server/utils/auth";

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const providerId = TextToImageProviderIdSchema.safeParse(event.context.params?.id);
    if (!providerId.success) {
        throw createError({statusCode: 400, message: "Provider ID 不合法"});
    }
    const resolved = await new TextToImageProviderService().resolveCredential(user.id, providerId.data);
    if (resolved.provider.kind !== "openai_compatible") {
        throw createError({statusCode: 400, message: "只有 OpenAI-compatible Provider 支持读取模型列表"});
    }
    try {
        return {models: await listTextToImageLlmModels({
            baseUrl: resolved.provider.baseUrl,
            credential: resolved.credential,
            allowPrivateNetwork: resolved.provider.settings.allowPrivateNetwork,
        })};
    } catch (error) {
        throw createError({
            statusCode: 502,
            message: "LLM 模型列表读取失败",
        });
    }
});
