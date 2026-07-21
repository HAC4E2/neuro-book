import {randomUUID} from "node:crypto";
import {CharacterVisualMigrationResolveRequestSchema} from "nbook/shared/text-to-image-character-migration";
import {isTagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";
import {throwTagIndexHttpError} from "nbook/server/text-to-image/tag-index/tag-index-http-error";
import {createCharacterVisualMigrationService} from "nbook/server/text-to-image/character-visual-migration.runtime";
import {throwCharacterVisualMigrationHttpError} from "nbook/server/text-to-image/character-visual-migration-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 使用 active Tag index 解析 proposal；approval identity 固定由当前用户生成。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, CharacterVisualMigrationResolveRequestSchema);
    try {
        return await (await createCharacterVisualMigrationService(body.projectPath)).resolve({
            ...body,
            approvals: body.approvals.map((approval) => ({
                ...approval,
                approvalId: `approval-${randomUUID()}`,
                actorId: `user-${user.id}`,
            })),
        });
    } catch (error) {
        if (isTagIndexError(error)) throwTagIndexHttpError(error);
        throwCharacterVisualMigrationHttpError(error);
    }
}));
