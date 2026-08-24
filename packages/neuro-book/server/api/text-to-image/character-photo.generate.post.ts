import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {generateCharacterAvatar} from "nbook/server/text-to-image/character-photo.service";
import {CharacterVisualRevisionConflictError} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveBoundTextToImageLlmRuntime} from "nbook/server/text-to-image/llm-runtime";
import {textToImageLlmTraceHub} from "nbook/server/text-to-image/llm-trace";

const CharacterPhotoGenerateBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    visualId: z.string().uuid(),
    selectedOutfitIndex: z.number().int().nonnegative().nullable().default(null),
    userRequirement: z.string().default(""),
}).strict();

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, CharacterPhotoGenerateBodySchema);
    const llmRuntime = await resolveBoundTextToImageLlmRuntime(user.id, "char_display");
    const trace = textToImageLlmTraceHub.start(user.id, {requestType: "char_display", profileId: llmRuntime.profileId, model: String(llmRuntime.settings.model ?? "")});
    try {
        return await generateCharacterAvatar({
            userId: user.id,
            llmRuntime,
            projectRoot: body.projectRoot,
            groupId: body.groupId,
            characterId: body.characterId,
            visualId: body.visualId,
            selectedOutfitIndex: body.selectedOutfitIndex,
            userRequirement: body.userRequirement,
            trace,
        });
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : "角色照片生成失败";
        throw createError({
            statusCode: cause instanceof CharacterVisualRevisionConflictError ? 409 : message.includes("HTTP 429") ? 429 : 502,
            message,
        });
    }
});
