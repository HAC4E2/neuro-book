import {createError, defineEventHandler, getRouterParam} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {
    TextToImageGenerationRecipeNotConfiguredError,
    TextToImageProviderNotConfiguredError,
    TextToImageProviderService,
} from "nbook/server/text-to-image/provider.service";

const ActiveGenerationRecipeBodySchema = z.object({
    recipeId: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const id = Number.parseInt(getRouterParam(event, "id") ?? "", 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw createError({statusCode: 400, message: "Provider id 必须是正整数"});
    }
    const body = await validateBody(event, ActiveGenerationRecipeBodySchema);
    try {
        return await new TextToImageProviderService().setActiveGenerationRecipe(user.id, id, body.recipeId);
    } catch (error) {
        if (error instanceof TextToImageGenerationRecipeNotConfiguredError) {
            throw createError({statusCode: 400, message: error.message});
        }
        if (error instanceof TextToImageProviderNotConfiguredError) {
            throw createError({statusCode: 404, message: "NovelAI Provider 不存在或未配置完整"});
        }
        throw error;
    }
});
