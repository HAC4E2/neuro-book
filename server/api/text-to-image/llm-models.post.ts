import {createError} from "h3";
import {
    listTextToImageLlmModels,
    TextToImageLlmModelsRequestSchema,
} from "nbook/server/text-to-image/llm-provider";

type TextToImageLlmModelsResponse = {
    models: string[];
};

export default defineEventHandler(async (event): Promise<TextToImageLlmModelsResponse> => {
    const parsed = TextToImageLlmModelsRequestSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues.map((issue) => issue.message).join("; ") || "LLM 模型列表请求参数不合法",
        });
    }

    try {
        return {models: await listTextToImageLlmModels(parsed.data)};
    } catch (error) {
        throw createError({
            statusCode: 502,
            message: error instanceof Error ? error.message : String(error),
        });
    }
});