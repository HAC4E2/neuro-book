import {CharacterVisualMigrationPrepareRequestSchema} from "nbook/shared/text-to-image-character-migration";
import {createCharacterVisualMigrationService} from "nbook/server/text-to-image/character-visual-migration.runtime";
import {throwCharacterVisualMigrationHttpError} from "nbook/server/text-to-image/character-visual-migration-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 从一个 legacy 角色目录创建 pending_unresolved proposal/report。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const body = await validateBody(event, CharacterVisualMigrationPrepareRequestSchema);
    try {
        return await (await createCharacterVisualMigrationService(body.projectPath)).prepare(body);
    } catch (error) {
        throwCharacterVisualMigrationHttpError(error);
    }
}));
