import {createError} from "h3";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {resolveTextToImageProviderHttpError} from "nbook/server/text-to-image/provider-http-error";
import {TextToImageNovelAiProviderPutSchema} from "nbook/server/text-to-image/schemas";
import {requireCurrentUser} from "nbook/server/utils/auth";

/** 首次创建、后续更新同一条 NovelAI Provider；不接受图片模型字段。 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const parsed = TextToImageNovelAiProviderPutSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({statusCode: 400, message: parsed.error.issues.map((issue) => issue.message).join("; ")});
    }
    try {
        return await new TextToImageProviderService().saveNovelAi(user.id, parsed.data);
    } catch (error) {
        const providerError = resolveTextToImageProviderHttpError(error);
        if (providerError) {
            throw providerError;
        }
        throw error;
    }
});
