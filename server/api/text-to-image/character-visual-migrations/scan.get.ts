import {getQuery} from "h3";
import {CharacterVisualMigrationProjectRequestSchema} from "nbook/shared/text-to-image-character-migration";
import {createCharacterVisualMigrationService} from "nbook/server/text-to-image/character-visual-migration.runtime";
import {throwCharacterVisualMigrationHttpError} from "nbook/server/text-to-image/character-visual-migration-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 只读扫描 Project 角色视觉文件的 legacy/V2 状态。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const parsed = CharacterVisualMigrationProjectRequestSchema.safeParse(getQuery(event));
    if (!parsed.success) throw createError({statusCode: 400, message: "projectPath 不合法"});
    try {
        return await (await createCharacterVisualMigrationService(parsed.data.projectPath)).scan(parsed.data);
    } catch (error) {
        throwCharacterVisualMigrationHttpError(error);
    }
}));
