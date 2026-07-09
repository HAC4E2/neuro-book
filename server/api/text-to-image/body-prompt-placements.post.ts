import {createError} from "h3";
import {
    BodyImagePromptPlacementRequestSchema,
    resolveBodyImagePromptPlacements,
    type BodyImagePromptPlacementResponse,
} from "nbook/server/text-to-image/body-image-prompt-placement";

/**
 * 为正文生图 LLM 返回的图片 prompt 定位正文插入段落。
 */
export default defineEventHandler(async (event): Promise<BodyImagePromptPlacementResponse> => {
    const parsed = BodyImagePromptPlacementRequestSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            statusMessage: "Invalid body image prompt placement request",
            message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        });
    }
    try {
        return await resolveBodyImagePromptPlacements(parsed.data);
    } catch (error) {
        throw createError({
            statusCode: 502,
            statusMessage: "Body image prompt placement failed",
            message: error instanceof Error ? error.message : String(error),
        });
    }
});
