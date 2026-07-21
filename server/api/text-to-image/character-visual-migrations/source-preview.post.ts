import {CharacterVisualSourcePreviewRequestSchema} from "nbook/shared/text-to-image-character-source";
import {createCharacterVisualMigrationService} from "nbook/server/text-to-image/character-visual-migration.runtime";
import {throwCharacterVisualMigrationHttpError} from "nbook/server/text-to-image/character-visual-migration-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 重建外部角色与一个缺失/legacy Project 目标的只读字段冲突预览。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const body = await validateBody(event, CharacterVisualSourcePreviewRequestSchema);
    try {
        return await (await createCharacterVisualMigrationService(body.projectPath)).previewSource(body);
    } catch (error) {
        throwCharacterVisualMigrationHttpError(error);
    }
}));
