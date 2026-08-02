import {
    CharacterVisualDirectWriteRequestSchema,
    generateCharacterVisualFiles,
} from "nbook/server/text-to-image/character-image-tags";
import {CharacterVisualDirectWriteResultSchema} from "nbook/shared/text-to-image-character-direct-write";
import {throwCharacterImageTagsHttpError} from "nbook/server/text-to-image/character-image-tags-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

/** 通过 illustration.director 直接生成并可恢复地写入角色视觉文件。 */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    await requireCurrentUser(event);
    const body = await validateBody(event, CharacterVisualDirectWriteRequestSchema);
    let result: Awaited<ReturnType<typeof generateCharacterVisualFiles>>;
    try {
        result = await generateCharacterVisualFiles(body);
    } catch (error) {
        throwCharacterImageTagsHttpError(error);
    }
    return CharacterVisualDirectWriteResultSchema.parse(result);
}));
