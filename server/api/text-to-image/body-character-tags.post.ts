import {createError} from "h3";
import {
    BodyImageCharacterTagsRequestSchema,
    resolveProjectBodyImageCharacterTagContext,
    type BodyImageCharacterTagContext,
} from "nbook/server/text-to-image/body-image-character-tags";

export default defineEventHandler(async (event): Promise<BodyImageCharacterTagContext> => {
    const parsed = BodyImageCharacterTagsRequestSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues.map((issue) => issue.message).join("; ") || "正文生图角色 tag 请求参数不合法",
        });
    }

    try {
        return await resolveProjectBodyImageCharacterTagContext(parsed.data);
    } catch (error) {
        throw createError({
            statusCode: 502,
            message: error instanceof Error ? error.message : String(error),
        });
    }
});
