import {CharacterVisualSourcePrepareRequestSchema} from "nbook/shared/text-to-image-character-source";
import {createCharacterVisualMigrationService} from "nbook/server/text-to-image/character-visual-migration.runtime";
import {throwCharacterVisualMigrationHttpError} from "nbook/server/text-to-image/character-visual-migration-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 接受全部 conflict 决策后创建统一角色视觉迁移 candidate。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const body = await validateBody(event, CharacterVisualSourcePrepareRequestSchema);
    try {
        return await (await createCharacterVisualMigrationService(body.projectPath)).prepareSource(body);
    } catch (error) {
        throwCharacterVisualMigrationHttpError(error);
    }
}));
