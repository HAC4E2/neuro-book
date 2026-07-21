import {CharacterVisualMigrationApplyRequestSchema} from "nbook/shared/text-to-image-character-migration";
import {createCharacterVisualMigrationService} from "nbook/server/text-to-image/character-visual-migration.runtime";
import {throwCharacterVisualMigrationHttpError} from "nbook/server/text-to-image/character-visual-migration-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** CAS 冻结逐项接受项并启动 tracked-write apply journal。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const body = await validateBody(event, CharacterVisualMigrationApplyRequestSchema);
    try {
        return await (await createCharacterVisualMigrationService(body.projectPath)).apply(body);
    } catch (error) {
        throwCharacterVisualMigrationHttpError(error);
    }
}));
