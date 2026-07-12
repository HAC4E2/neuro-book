import {createError} from "h3";
import {
    CharacterImageTagsGenerateRequestSchema,
    generateCharacterImageTags,
    type CharacterImageTagsGenerateResult,
} from "nbook/server/text-to-image/character-image-tags";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {requireCurrentUser} from "nbook/server/utils/auth";

/**
 * 从角色详情页生成同目录 image-tags.md。
 */
export default defineEventHandler(async (event): Promise<CharacterImageTagsGenerateResult> => {
    const user = await requireCurrentUser(event);
    const parsed = CharacterImageTagsGenerateRequestSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            statusMessage: "Invalid character image-tags request",
            message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        });
    }
    const resolved = await new TextToImageProviderService().resolveCredential(user.id, parsed.data.llm.providerId);
    if (resolved.provider.kind !== "openai_compatible") {
        throw createError({statusCode: 400, message: "角色 image-tag 生成需要 OpenAI-compatible Provider"});
    }
    try {
        return await generateCharacterImageTags(parsed.data, {
            baseUrl: resolved.provider.baseUrl,
            credential: resolved.credential,
            allowPrivateNetwork: resolved.provider.settings.allowPrivateNetwork,
            model: resolved.provider.model,
        });
    } catch (error) {
        throw createError({
            statusCode: 502,
            statusMessage: "Character image-tags generation failed",
            message: error instanceof Error ? error.message : String(error),
        });
    }
});
