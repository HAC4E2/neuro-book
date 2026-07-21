import {CharacterVisualMigrationReadRequestSchema} from "nbook/shared/text-to-image-character-migration";
import {createCharacterVisualMigrationService} from "nbook/server/text-to-image/character-visual-migration.runtime";
import {throwCharacterVisualMigrationHttpError} from "nbook/server/text-to-image/character-visual-migration-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 从持久 apply journal 恢复中断升级，不重新 Resolver 或覆盖漂移文件。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const body = await validateBody(event, CharacterVisualMigrationReadRequestSchema);
    try {
        return await (await createCharacterVisualMigrationService(body.projectPath)).resume(body);
    } catch (error) {
        throwCharacterVisualMigrationHttpError(error);
    }
}));
