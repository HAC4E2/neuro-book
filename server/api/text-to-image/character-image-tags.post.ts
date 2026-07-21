import {createError} from "h3";
import {
    CharacterVisualDirectorGenerateRequestSchema,
    CharacterVisualProposalError,
    generateCharacterVisualProposal,
} from "nbook/server/text-to-image/character-image-tags";
import {throwCharacterVisualMigrationHttpError} from "nbook/server/text-to-image/character-visual-migration-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 通过 illustration.director 生成不可执行角色视觉 proposal；不直接写 image-tags。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const body = await validateBody(event, CharacterVisualDirectorGenerateRequestSchema);
    try {
        return await generateCharacterVisualProposal(body);
    } catch (error) {
        if (error instanceof CharacterVisualProposalError) {
            throw createError({statusCode: 409, message: error.message, data: {code: error.code}});
        }
        throwCharacterVisualMigrationHttpError(error);
    }
}));
