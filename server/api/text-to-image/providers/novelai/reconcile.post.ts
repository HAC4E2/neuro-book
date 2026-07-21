import {createError} from "h3";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {resolveTextToImageProviderHttpError} from "nbook/server/text-to-image/provider-http-error";
import {TextToImageNovelAiReconcileSchema} from "nbook/server/text-to-image/schemas";
import {requireCurrentUser} from "nbook/server/utils/auth";

/** 一次性显式保留一条旧 NovelAI Provider；绝不按时间或名称自动猜选。 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const parsed = TextToImageNovelAiReconcileSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({statusCode: 400, message: parsed.error.issues.map((issue) => issue.message).join("; ")});
    }
    try {
        return await new TextToImageProviderService().reconcileNovelAi(user.id, parsed.data);
    } catch (error) {
        const providerError = resolveTextToImageProviderHttpError(error);
        if (providerError) {
            throw providerError;
        }
        throw error;
    }
});
