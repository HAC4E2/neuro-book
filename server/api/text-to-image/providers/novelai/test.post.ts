import {createError} from "h3";
import {z} from "zod";
import {fetchTextToImageProvider} from "nbook/server/text-to-image/provider-fetch";
import {
    TextToImageProviderNotConfiguredError,
    TextToImageProviderSelectionRequiredError,
    TextToImageProviderService,
} from "nbook/server/text-to-image/provider.service";
import {resolveTextToImageProviderHttpError} from "nbook/server/text-to-image/provider-http-error";
import {
    TextToImageRecipeNotConfiguredError,
    TextToImageRecipeService,
} from "nbook/server/text-to-image/recipe.service";
import {throwTextToImageRecipeHttpError} from "nbook/server/text-to-image/recipe-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";

const BodySchema = z.object({projectPath: z.string().trim().min(1)}).strict();
const NOVELAI_API_URL = "https://api.novelai.net";

/** 通过无图片计费的官方 suggest-tags API 同时验证 token、连通性与当前 Recipe 模型。 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const parsed = BodySchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({statusCode: 400, message: parsed.error.issues.map((issue) => issue.message).join("; ")});
    }
    try {
        const recipe = await new TextToImageRecipeService().read(parsed.data.projectPath);
        if (!recipe.exists) {
            throw new TextToImageRecipeNotConfiguredError();
        }
        const inspection = await new TextToImageProviderService().inspectNovelAi(user.id);
        if (inspection.state === "selection_required") {
            throw new TextToImageProviderSelectionRequiredError();
        }
        if (!inspection.provider) {
            throw new TextToImageProviderNotConfiguredError();
        }
        const resolved = await new TextToImageProviderService().resolveNovelAiCredential(user.id, inspection.provider.id);
        const url = new URL("/ai/generate-image/suggest-tags", NOVELAI_API_URL);
        url.searchParams.set("model", recipe.source.model);
        url.searchParams.set("prompt", "1girl");
        const response = await fetchTextToImageProvider(url, {
            method: "GET",
            headers: {Authorization: `Bearer ${resolved.credential}`},
        }, {allowPrivateNetwork: false});
        if (!response.ok) {
            throw createError({statusCode: 502, message: `NovelAI 测试失败：${response.status}`});
        }
        await response.body?.cancel();
        return {ok: true, providerId: inspection.provider.id, model: recipe.source.model};
    } catch (error) {
        const providerError = resolveTextToImageProviderHttpError(error);
        if (providerError) {
            throw providerError;
        }
        throwTextToImageRecipeHttpError(error);
    }
});
