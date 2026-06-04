import {createError} from "h3";
import {generateNovelAiImage, TextToImageGenerateRequestSchema, type TextToImageGenerateResponse} from "nbook/server/text-to-image/novelai-image-generation";

export default defineEventHandler(async (event): Promise<TextToImageGenerateResponse> => {
    const parsed = TextToImageGenerateRequestSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues.map((issue) => issue.message).join("; ") || "文生图请求参数不合法",
        });
    }

    try {
        return await generateNovelAiImage(parsed.data);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw createError({
            statusCode: isClientInputError(message) ? 400 : 502,
            message,
        });
    }
});

function isClientInputError(message: string): boolean {
    return [
        "NovelAI Persistent Token 不能为空",
        "正面 prompt 不能为空",
        "图片保存路径必须是本地绝对路径",
        "图片保存路径不是文件夹",
    ].some((prefix) => message.startsWith(prefix));
}
