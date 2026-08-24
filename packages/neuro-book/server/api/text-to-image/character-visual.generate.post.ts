import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {TextToImageLlmProviderSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import {
    CharacterVisualLibraryService,
} from "nbook/server/text-to-image/character-visual-library.service";
import {generateCharacterVisualDraft} from "nbook/server/text-to-image/character-visual-llm";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {resolveBoundTextToImageLlmRuntime} from "nbook/server/text-to-image/llm-runtime";
import {textToImageLlmTraceHub} from "nbook/server/text-to-image/llm-trace";

const CharacterVisualGenerateBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    groupId: z.string().trim().min(1).default("default"),
    characterPage: z.string().default(""),
    userRequirement: z.string().default(""),
}).strict();

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, CharacterVisualGenerateBodySchema);
    const runtime = await resolveBoundTextToImageLlmRuntime(user.id, "char_design");
    const settings = TextToImageLlmProviderSettingsSchema.parse(runtime.settings);
    const trace = textToImageLlmTraceHub.start(user.id, {requestType: "char_design", profileId: runtime.profileId, model: settings.model});
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    const library = new CharacterVisualLibraryService();
    const existing = await library.readWithInfo(projectRoot, {
        groupId: body.groupId,
        characterId: body.characterId,
    });
    if (existing) {
        throw createError({statusCode: 409, message: "该角色已有视觉资料，请使用“生成修改预览”"});
    }
    const visual = await generateCharacterVisualDraft({
        provider: {
            baseUrl: settings.baseUrl,
            credential: runtime.credential,
            settings: runtime.settings,
        },
        characterId: body.characterId,
        characterPage: body.characterPage,
        existingSummary: "",
        mode: "fill_empty",
        userRequirement: body.userRequirement,
        contextEntries: runtime.contextEntries,
        runtime: {
            body: body.characterPage,
            userDemand: body.userRequirement,
            characterSource: body.characterPage,
            triggerText: `${body.characterPage}\n${body.characterId}\n${body.userRequirement}`,
        },
        promptMode: runtime.promptMode,
        trace,
    });
    return {
        visual,
        current: null,
        currentFile: null,
        baseRevision: null,
    };
});
