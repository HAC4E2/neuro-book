import {createError} from "h3";
import {ZodError} from "zod";
import {IllustrationSelectionError} from "nbook/server/text-to-image/illustration-chapter-parser";
import {CharacterVisualRegistryError} from "nbook/server/text-to-image/character-visual-registry.service";
import {IllustrationPlanningInputError} from "nbook/server/text-to-image/illustration-planning-input.builder";
import {
    TextToImageRecipeConflictError,
    TextToImageRecipeInvalidError,
    TextToImageRecipeNotConfiguredError,
} from "nbook/server/text-to-image/recipe.service";
import {throwTextToImageRecipeHttpError} from "nbook/server/text-to-image/recipe-http-error";
import {isTagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";
import {throwTagIndexHttpError} from "nbook/server/text-to-image/tag-index/tag-index-http-error";
import {IllustrationWorkflowStateError} from "nbook/server/text-to-image/illustration-workflow.repository";
import {IllustrationWorkflowAccessError} from "nbook/server/text-to-image/illustration-workflow.service";

/** Planning 输入/状态错误的统一 HTTP 出口。 */
export function throwIllustrationWorkflowHttpError(error: unknown): never {
    if (error instanceof TextToImageRecipeConflictError
        || error instanceof TextToImageRecipeInvalidError
        || error instanceof TextToImageRecipeNotConfiguredError) {
        throwTextToImageRecipeHttpError(error);
    }
    if (isTagIndexError(error)) throwTagIndexHttpError(error);
    if (error instanceof IllustrationWorkflowAccessError) {
        throw createError({
            statusCode: error.code === "ILLUSTRATION_WORKFLOW_NOT_FOUND" ? 404 : 409,
            message: error.message,
            data: {code: error.code},
        });
    }
    if (error instanceof IllustrationWorkflowStateError) {
        throw createError({
            statusCode: error.code === "ILLUSTRATION_WORKFLOW_NOT_FOUND" ? 404 : 409,
            message: error.message,
            data: {code: error.code},
        });
    }
    if (error instanceof IllustrationPlanningInputError) {
        throw createError({statusCode: error.code === "ILLUSTRATION_CHAPTER_EMPTY" ? 422 : 409, message: error.message, data: {code: error.code}});
    }
    if (error instanceof IllustrationSelectionError) {
        throw createError({
            statusCode: error.code === "ILLUSTRATION_CHAPTER_CONFLICT" ? 409 : 422,
            message: error.message,
            data: {code: error.code},
        });
    }
    if (error instanceof CharacterVisualRegistryError) {
        throw createError({
            statusCode: 422,
            message: error.message,
            data: {code: error.code},
        });
    }
    if (error instanceof ZodError) {
        throw createError({statusCode: 422, message: "Planning 真相源不符合严格合同", data: {code: "ILLUSTRATION_PLANNING_INPUT_INVALID"}});
    }
    throw error;
}
