import {createError} from "h3";
import {z} from "zod";
import {TextToImageRecipeService} from "nbook/server/text-to-image/recipe.service";
import {throwTextToImageRecipeHttpError} from "nbook/server/text-to-image/recipe-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";

const QuerySchema = z.object({
    projectPath: z.string().trim().min(1),
}).strict();

/** 只读返回当前 Project 的默认 NovelAI Recipe 与规范化 snapshot。 */
export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const parsed = QuerySchema.safeParse(getQuery(event));
    if (!parsed.success) {
        throw createError({statusCode: 400, message: "projectPath 不能为空"});
    }
    try {
        return await new TextToImageRecipeService().read(parsed.data.projectPath);
    } catch (error) {
        throwTextToImageRecipeHttpError(error);
    }
});
