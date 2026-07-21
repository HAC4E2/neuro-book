import {createError} from "h3";
import {TextToImageJobCreateSchema} from "nbook/server/text-to-image/schemas";
import {createTextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {TextToImageRecipeService} from "nbook/server/text-to-image/recipe.service";
import {throwTextToImageRecipeHttpError} from "nbook/server/text-to-image/recipe-http-error";
import {resolveTextToImageProviderHttpError} from "nbook/server/text-to-image/provider-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const parsed = TextToImageJobCreateSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({statusCode: 400, message: parsed.error.issues.map((issue) => issue.message).join("; ") || "文生图任务参数不合法"});
    }
    try {
        const compiled = await new TextToImageRecipeService().compileManual({
            projectPath: parsed.data.projectPath,
            prompt: parsed.data.prompt,
            negativePrompt: parsed.data.negativePrompt,
            count: parsed.data.count,
            expectedRecipeSourceHash: parsed.data.expectedRecipeSourceHash,
        });
        return await createTextToImageQueueService(user.id).enqueue({
            projectPath: parsed.data.projectPath,
            providerId: parsed.data.providerId,
            kind: parsed.data.kind,
            ...compiled,
        });
    } catch (error) {
        const providerError = resolveTextToImageProviderHttpError(error);
        if (providerError) {
            throw providerError;
        }
        throwTextToImageRecipeHttpError(error);
    }
});
