import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {CharacterVisualFileSchema} from "nbook/server/text-to-image/character-visual.codec";
import {TriggerWordFormatError} from "nbook/server/text-to-image/character-trigger-words";
import {
    CharacterIdentityFieldConflictError,
    CharacterVisualLibraryService,
    CharacterVisualRevisionConflictError,
} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    visualId: z.string().uuid().optional(),
    action: z.enum(["overwrite", "create_new"]),
    expectedUpdatedAt: z.string().datetime().optional(),
    fileName: z.string().trim().optional(),
    draft: CharacterVisualFileSchema,
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, BodySchema);
    if (body.action === "overwrite" && (!body.visualId || !body.expectedUpdatedAt)) {
        throw createError({statusCode: 400, message: "覆盖视觉资料需要 visualId 和 expectedUpdatedAt"});
    }
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    const service = new CharacterVisualLibraryService();
    try {
        if (body.action === "create_new") {
            return await service.createNewVersion(projectRoot, {
                groupId: body.groupId,
                characterId: body.characterId,
                baseVisualId: body.visualId,
            }, body.draft, {
                fileName: body.fileName,
                expectedUpdatedAt: body.expectedUpdatedAt,
                source: "llm",
            });
        }
        return await service.write(projectRoot, {
            groupId: body.groupId,
            characterId: body.characterId,
            visualId: body.visualId,
        }, body.draft, {
            expectedUpdatedAt: body.expectedUpdatedAt,
            source: "llm",
            setActive: true,
        });
    } catch (cause) {
        if (cause instanceof CharacterVisualRevisionConflictError
            || cause instanceof CharacterIdentityFieldConflictError) {
            throw createError({statusCode: 409, message: cause.message});
        }
        if (cause instanceof TriggerWordFormatError) {
            throw createError({statusCode: 400, message: cause.message});
        }
        throw cause;
    }
});
