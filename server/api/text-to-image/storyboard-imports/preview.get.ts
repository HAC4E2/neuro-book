import {getQuery} from "h3";
import {z} from "zod";
import {StoryboardStableIdSchema} from "nbook/shared/text-to-image-storyboard-preset";
import {readStoryboardImportPreview} from "nbook/server/text-to-image/storyboard-import.service";
import {throwStoryboardImportHttpError} from "nbook/server/text-to-image/storyboard-import-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";

const QuerySchema = z.object({importId: StoryboardStableIdSchema}).strict();

/** 读取并复验 Director 已写入的 pending companion，只提供审查视图。 */
export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const parsed = QuerySchema.safeParse(getQuery(event));
    if (!parsed.success) throw createError({statusCode: 400, message: "importId 不合法"});
    try {
        return await readStoryboardImportPreview(parsed.data);
    } catch (error) {
        throwStoryboardImportHttpError(error);
    }
});
