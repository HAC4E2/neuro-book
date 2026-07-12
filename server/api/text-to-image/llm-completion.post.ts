import {createError} from "h3";
import {
    requestTextToImageLlmCompletion,
    TextToImageLlmCompletionRequestSchema,
    type TextToImageLlmCompletionResponse,
} from "nbook/server/text-to-image/llm-provider";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {requireCurrentUser} from "nbook/server/utils/auth";

export default defineEventHandler(async (event): Promise<TextToImageLlmCompletionResponse> => {
    const user = await requireCurrentUser(event);
    const parsed = TextToImageLlmCompletionRequestSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues.map((issue) => issue.message).join("; ") || "LLM 请求参数不合法",
        });
    }

    try {
        const resolved = await new TextToImageProviderService().resolveCredential(user.id, parsed.data.providerId);
        if (resolved.provider.kind !== "openai_compatible") {
            throw createError({statusCode: 400, message: "只有 OpenAI-compatible Provider 支持 LLM 补全"});
        }
        return {content: await requestTextToImageLlmCompletion({
            baseUrl: resolved.provider.baseUrl,
            credential: resolved.credential,
            allowPrivateNetwork: resolved.provider.settings.allowPrivateNetwork,
            model: parsed.data.model,
            parameters: parsed.data.parameters,
            stream: parsed.data.stream,
            messages: parsed.data.messages,
        })};
    } catch (error) {
        if (error && typeof error === "object" && "statusCode" in error) {
            throw error;
        }
        throw createError({
            statusCode: 502,
            message: "LLM 请求失败",
        });
    }
});
