import {CharacterVisualSourceInspectRequestSchema} from "nbook/shared/text-to-image-character-source";
import {createCharacterVisualMigrationService} from "nbook/server/text-to-image/character-visual-migration.runtime";
import {throwCharacterVisualMigrationHttpError} from "nbook/server/text-to-image/character-visual-migration-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** Strict inspect 一个 Project upload 顶层的公开明文角色视觉源。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const body = await validateBody(event, CharacterVisualSourceInspectRequestSchema);
    try {
        return await (await createCharacterVisualMigrationService(body.projectPath)).inspectSource(body);
    } catch (error) {
        throwCharacterVisualMigrationHttpError(error);
    }
}));
