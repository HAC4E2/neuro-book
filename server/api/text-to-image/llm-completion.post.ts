import {createError} from "h3";
import {
    requestTextToImageLlmCompletion,
    TextToImageLlmCompletionRequestSchema,
    type TextToImageLlmCompletionResponse,
} from "nbook/server/text-to-image/llm-provider";

export default defineEventHandler(async (event): Promise<TextToImageLlmCompletionResponse> => {
    const parsed = TextToImageLlmCompletionRequestSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues.map((issue) => issue.message).join("; ") || "LLM 请求参数不合法",
        });
    }

    try {
        return {content: await requestTextToImageLlmCompletion(parsed.data)};
    } catch (error) {
        throw createError({
            statusCode: 502,
            message: error instanceof Error ? error.message : String(error),
        });
    }
});