import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {CharacterVisualFileSchema} from "nbook/server/text-to-image/character-visual.codec";
import {
    CharacterIdentityDamagedFileError,
    CharacterIdentityRevisionConflictError,
    updateCharacterIdentity,
} from "nbook/server/text-to-image/character-identity.service";
import {TriggerWordFormatError} from "nbook/server/text-to-image/character-trigger-words";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    identity: z.object({
        cnName: z.string().max(200).default(""),
        enName: z.string().max(200).default(""),
        triggerWords: z.string().max(2000).default(""),
    }).strict(),
    selectedVisual: z.object({
        groupId: z.string().trim().min(1),
        visualId: z.string().uuid(),
        expectedUpdatedAt: z.string().datetime().optional(),
        visual: CharacterVisualFileSchema,
    }).strict().nullable().default(null),
    expectedIdentityRevision: z.string().trim().min(1).nullable().default(null),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, BodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    try {
        return await updateCharacterIdentity({
            projectRoot,
            characterId: body.characterId,
            identity: body.identity,
            selectedVisual: body.selectedVisual,
            expectedIdentityRevision: body.expectedIdentityRevision,
        });
    } catch (cause) {
        if (cause instanceof CharacterIdentityRevisionConflictError
            || cause instanceof CharacterIdentityDamagedFileError) {
            throw createError({statusCode: 409, message: cause.message});
        }
        if (cause instanceof TriggerWordFormatError) {
            throw createError({statusCode: 400, message: cause.message});
        }
        throw cause;
    }
});
