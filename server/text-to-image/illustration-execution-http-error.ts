import {createError} from "h3";
import {ZodError} from "zod";
import {NovelAiCapabilityError} from "nbook/shared/text-to-image-provider-registry";
import {CharacterVisualRegistryError} from "nbook/server/text-to-image/character-visual-registry.service";
import {IllustrationCompileError} from "nbook/server/text-to-image/illustration-compiler";
import {
    IllustrationExecutionCompilerError,
} from "nbook/server/text-to-image/illustration-execution.compiler";
import {IllustrationExecutionServiceError} from "nbook/server/text-to-image/illustration-execution.service";
import {ExecutionPreviewTokenError} from "nbook/server/text-to-image/execution-preview-token";
import {IllustrationExecutionRegistrationError} from "nbook/server/text-to-image/execution.repository";
import {resolveTextToImageProviderHttpError} from "nbook/server/text-to-image/provider-http-error";
import {
    TextToImageManualReferencesUnsupportedError,
    TextToImageRecipeConflictError,
    TextToImageRecipeInvalidError,
    TextToImageRecipeNotConfiguredError,
} from "nbook/server/text-to-image/recipe.service";
import {throwTextToImageRecipeHttpError} from "nbook/server/text-to-image/recipe-http-error";
import {isTagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";
import {throwTagIndexHttpError} from "nbook/server/text-to-image/tag-index/tag-index-http-error";

/** Execution Preview 的统一稳定 HTTP 错误出口。 */
export function throwIllustrationExecutionHttpError(error: unknown): never {
    if (error instanceof TextToImageRecipeConflictError
        || error instanceof TextToImageRecipeInvalidError
        || error instanceof TextToImageRecipeNotConfiguredError
        || error instanceof TextToImageManualReferencesUnsupportedError) {
        throwTextToImageRecipeHttpError(error);
    }
    const providerError = resolveTextToImageProviderHttpError(error);
    if (providerError) throw providerError;
    if (isTagIndexError(error)) throwTagIndexHttpError(error);
    if (error instanceof CharacterVisualRegistryError) {
        throw createError({
            statusCode: 422,
            message: error.message,
            data: {code: error.code},
        });
    }
    if (error instanceof NovelAiCapabilityError) {
        throw createError({
            statusCode: 422,
            message: error.message,
            data: {code: error.code},
        });
    }
    if (error instanceof IllustrationExecutionCompilerError) {
        const statusCode = error.code === "ILLUSTRATION_EXECUTION_TARGET_NOT_FOUND"
            ? 404
            : error.code === "TEXT_TO_IMAGE_RECIPE_STYLE_INVALID" ? 422 : 409;
        throw createError({statusCode, message: error.message, data: {code: error.code}});
    }
    if (error instanceof IllustrationCompileError) {
        const statusCode = error.code === "ILLUSTRATION_SHOT_STALE" ? 409 : 422;
        throw createError({statusCode, message: error.message, data: {code: error.code}});
    }
    if (error instanceof IllustrationExecutionServiceError) {
        const statusCode = error.code === "ILLUSTRATION_PREVIEW_NOT_CONFIGURED"
            ? 500
            : error.code === "ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED" ? 409 : 422;
        throw createError({statusCode, message: error.message, data: {code: error.code}});
    }
    if (error instanceof ExecutionPreviewTokenError) {
        throw createError({
            statusCode: error.code === "ILLUSTRATION_PREVIEW_TOKEN_EXPIRED" ? 409 : 400,
            message: error.message,
            data: {code: error.code},
        });
    }
    if (error instanceof IllustrationExecutionRegistrationError) {
        throw createError({
            statusCode: error.code === "ILLUSTRATION_EXECUTION_REGISTRATION_CONFLICT" ? 409 : 422,
            message: error.message,
            data: {code: error.code},
        });
    }
    if (error instanceof ZodError) {
        throw createError({
            statusCode: 422,
            message: "Execution Preview 真相源不符合严格合同",
            data: {code: "ILLUSTRATION_PREVIEW_INVALID"},
        });
    }
    throw error;
}
