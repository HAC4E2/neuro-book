import {
    CharacterVisualDirectWriteRequestSchema,
    generateCharacterVisualFiles,
} from "nbook/server/text-to-image/character-image-tags";
import {throwCharacterImageTagsHttpError} from "nbook/server/text-to-image/character-image-tags-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/** 通过 illustration.director 直接生成并可恢复地写入角色视觉文件。 */
export default defineEventHandler((event) => withProjectNotOpenHttpError(async () => {
    await requireCurrentUser(event);
    const body = await validateBody(event, CharacterVisualDirectWriteRequestSchema);
    try {
        return await generateCharacterVisualFiles(body);
    } catch (error) {
        throwCharacterImageTagsHttpError(error);
    }
}));
