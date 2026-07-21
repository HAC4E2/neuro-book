import {createError} from "h3";
import {CharacterVisualMigrationError} from "nbook/server/text-to-image/character-visual-migration.service";

/** 把角色视觉迁移业务错误映射到稳定 HTTP 400/404/409。 */
export function throwCharacterVisualMigrationHttpError(error: unknown): never {
    if (error instanceof CharacterVisualMigrationError) {
        const statusCode = error.code === "MIGRATION_NOT_FOUND"
            ? 404
            : error.code === "MIGRATION_INVALID"
                ? 400
                : 409;
        throw createError({statusCode, message: error.message, data: {code: error.code}});
    }
    throw error;
}
