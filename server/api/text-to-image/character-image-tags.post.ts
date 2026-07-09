import {createError} from "h3";
import {
    CharacterImageTagsGenerateRequestSchema,
    generateCharacterImageTags,
    type CharacterImageTagsGenerateResult,
} from "nbook/server/text-to-image/character-image-tags";

/**
 * 从角色详情页生成同目录 image-tags.md。
 */
export default defineEventHandler(async (event): Promise<CharacterImageTagsGenerateResult> => {
    const parsed = CharacterImageTagsGenerateRequestSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            statusMessage: "Invalid character image-tags request",
            message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        });
    }
    try {
        return await generateCharacterImageTags(parsed.data);
    } catch (error) {
        throw createError({
            statusCode: 502,
            statusMessage: "Character image-tags generation failed",
            message: error instanceof Error ? error.message : String(error),
        });
    }
});
