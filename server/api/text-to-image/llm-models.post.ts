import {createError} from "h3";
import {
    listTextToImageLlmModels,
    TextToImageLlmModelsRequestSchema,
} from "nbook/server/text-to-image/llm-provider";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {requireCurrentUser} from "nbook/server/utils/auth";

type TextToImageLlmModelsResponse = {
    models: string[];
};

export default defineEventHandler(async (event): Promise<TextToImageLlmModelsResponse> => {
    const user = await requireCurrentUser(event);
    const parsed = TextToImageLlmModelsRequestSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues.map((issue) => issue.message).join("; ") || "LLM 模型列表请求参数不合法",
        });
    }

    try {
        const resolved = await new TextToImageProviderService().resolveCredential(user.id, parsed.data.providerId);
        if (resolved.provider.kind !== "openai_compatible") {
            throw createError({statusCode: 400, message: "只有 OpenAI-compatible Provider 支持读取模型列表"});
        }
        return {models: await listTextToImageLlmModels({
            baseUrl: resolved.provider.baseUrl,
            credential: resolved.credential,
            allowPrivateNetwork: resolved.provider.settings.allowPrivateNetwork,
        })};
    } catch (error) {
        if (error && typeof error === "object" && "statusCode" in error) {
            throw error;
        }
        throw createError({
            statusCode: 502,
            message: "LLM 模型列表读取失败",
        });
    }
});
