import {getQuery} from "h3";
import {CharacterVisualMigrationReadRequestSchema} from "nbook/shared/text-to-image-character-migration";
import {createCharacterVisualMigrationService} from "nbook/server/text-to-image/character-visual-migration.runtime";
import {throwCharacterVisualMigrationHttpError} from "nbook/server/text-to-image/character-visual-migration-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 读取 migration candidate/resolution 快照，不访问 Tag index。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const parsed = CharacterVisualMigrationReadRequestSchema.safeParse(getQuery(event));
    if (!parsed.success) throw createError({statusCode: 400, message: "migration query 不合法"});
    try {
        return await (await createCharacterVisualMigrationService(parsed.data.projectPath)).read(parsed.data);
    } catch (error) {
        throwCharacterVisualMigrationHttpError(error);
    }
}));
