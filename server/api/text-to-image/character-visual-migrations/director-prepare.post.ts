import {CharacterVisualDirectorPrepareRequestSchema} from "nbook/shared/text-to-image-character-source";
import {createCharacterVisualMigrationService} from "nbook/server/text-to-image/character-visual-migration.runtime";
import {throwCharacterVisualMigrationHttpError} from "nbook/server/text-to-image/character-visual-migration-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 将持久 Director proposal 的冲突决策转换成统一 migration candidate。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const body = await validateBody(event, CharacterVisualDirectorPrepareRequestSchema);
    try {
        return await (await createCharacterVisualMigrationService(body.projectPath)).prepareDirectorProposal(body);
    } catch (error) {
        throwCharacterVisualMigrationHttpError(error);
    }
}));
