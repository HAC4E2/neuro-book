import {createError} from "h3";
import {z} from "zod";
import {TextToImageRecipeSourceSchema} from "nbook/shared/text-to-image-recipe";
import {TextToImageRecipeService} from "nbook/server/text-to-image/recipe.service";
import {throwTextToImageRecipeHttpError} from "nbook/server/text-to-image/recipe-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";

const BodySchema = z.object({
    projectPath: z.string().trim().min(1),
    source: TextToImageRecipeSourceSchema,
    expectedRecipeSourceHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
    expectedInvalidSourceHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
}).strict().superRefine((value, context) => {
    if (value.expectedInvalidSourceHash && value.expectedRecipeSourceHash !== null) {
        context.addIssue({code: "custom", message: "修复无效 Recipe 时 expectedRecipeSourceHash 必须为 null"});
    }
});

/** 显式保存默认 Recipe；这是文生图分页唯一的 Recipe 写入口。 */
export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const parsed = BodySchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({statusCode: 400, message: parsed.error.issues.map((issue) => issue.message).join("; ")});
    }
    try {
        return await new TextToImageRecipeService().save(parsed.data);
    } catch (error) {
        throwTextToImageRecipeHttpError(error);
    }
});
