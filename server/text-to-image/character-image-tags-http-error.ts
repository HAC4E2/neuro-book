import {createError} from "h3";
import {ZodError} from "zod";
import {CharacterVisualDirectWriteError} from "nbook/server/text-to-image/character-visual-direct-write.service";

/** 将 direct-write 的冻结业务错误映射到 API 可恢复的 HTTP contract。 */
export function throwCharacterImageTagsHttpError(error: unknown): never {
    if (error instanceof ZodError) {
        throw createError({statusCode: 400, message: "角色视觉请求不符合 contract", data: {code: "CHARACTER_VISUAL_REQUEST_INVALID"}});
    }
    if (error instanceof CharacterVisualDirectWriteError) {
        throw createError({statusCode: 409, message: error.message, data: {code: error.code}});
    }
    throw error;
}
