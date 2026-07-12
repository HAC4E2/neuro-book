import {createError} from "h3";
import {BodyPromptRequestSchema, TextToImageBodyPromptService} from "nbook/server/text-to-image/body-prompt.service";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const parsed = BodyPromptRequestSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({statusCode: 400, message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")});
    }
    assertProjectOpenForRoot(parsed.data.projectPath);
    const resolved = await new TextToImageProviderService().resolveCredential(user.id, parsed.data.llmProviderId);
    if (resolved.provider.kind !== "openai_compatible") {
        throw createError({statusCode: 400, message: "正文提示词生成需要 OpenAI-compatible Provider"});
    }
    try {
        return await new TextToImageBodyPromptService().generate(parsed.data, {
            baseUrl: resolved.provider.baseUrl,
            credential: resolved.credential,
            allowPrivateNetwork: resolved.provider.settings.allowPrivateNetwork,
            model: resolved.provider.model,
        });
    } catch (error) {
        if (error instanceof Error && error.name === "TextToImageChapterConflictError") {
            throw createError({statusCode: 409, data: {code: "TEXT_TO_IMAGE_CHAPTER_CONFLICT"}, message: error.message});
        }
        throw error;
    }
});
