import {createError} from "h3";
import {Chatu8StoryboardJsonError} from "nbook/server/text-to-image/chatu8-storyboard-json";
import {StoryboardImportError} from "nbook/server/text-to-image/storyboard-import.service";
import {StoryboardPublishError} from "nbook/server/text-to-image/storyboard-publish.service";

/** 把导入领域错误映射为稳定 HTTP 状态与 code，不泄露内部路径或 secret。 */
export function throwStoryboardImportHttpError(error: unknown): never {
    if (error instanceof Chatu8StoryboardJsonError) {
        throw createError({
            statusCode: error.code === "STORYBOARD_IMPORT_FILE_TOO_LARGE" ? 413 : 400,
            message: error.message,
            data: {code: error.code},
        });
    }
    if (error instanceof StoryboardImportError) {
        const statusCode = error.code === "STORYBOARD_IMPORT_SOURCE_NOT_FOUND"
            || error.code === "STORYBOARD_IMPORT_ARCHIVE_NOT_FOUND"
            ? 404
            : error.code === "STORYBOARD_IMPORT_SOURCE_CHANGED"
                || error.code === "STORYBOARD_IMPORT_PREVIEW_NOT_READY"
                || error.code === "STORYBOARD_IMPORT_JOURNAL_INVALID"
                || error.code === "STORYBOARD_IMPORT_ARCHIVE_CONFLICT"
                || error.code === "STORYBOARD_IMPORT_CONVERSION_CONFLICT"
                ? 409
                : 400;
        throw createError({statusCode, message: error.message, data: {code: error.code}});
    }
    if (error instanceof StoryboardPublishError) {
        const statusCode = error.code === "STORYBOARD_IMPORT_APPROVAL_INVALID" ? 400 : 409;
        throw createError({statusCode, message: error.message, data: {code: error.code}});
    }
    throw error;
}
