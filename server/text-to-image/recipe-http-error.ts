import {createError} from "h3";
import {
    TextToImageRecipeConflictError,
    TextToImageRecipeInvalidError,
    TextToImageRecipeNotConfiguredError,
} from "nbook/server/text-to-image/recipe.service";

/** 把 Recipe 领域错误映射为所有 HTTP 入口共享的稳定状态码与错误 code。 */
export function throwTextToImageRecipeHttpError(error: unknown): never {
    if (error instanceof TextToImageRecipeInvalidError) {
        throw createError({
            statusCode: 422,
            message: error.message,
            data: {
                code: error.code,
                fileContentHash: error.fileContentHash,
            },
        });
    }
    if (error instanceof TextToImageRecipeConflictError || error instanceof TextToImageRecipeNotConfiguredError) {
        throw createError({
            statusCode: 409,
            message: error.message,
            data: {code: error.code},
        });
    }
    throw error;
}
