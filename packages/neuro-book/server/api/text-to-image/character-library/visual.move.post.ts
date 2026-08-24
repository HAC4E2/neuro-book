import {createError, defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {
    commitVisualMove,
    VisualMoveEquivalentConflictError,
    VisualMoveInvalidTargetError,
    VisualMoveRevisionConflictError,
    VisualMoveStaleSourceError,
} from "nbook/server/text-to-image/character-visual-move.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    sourceGroupId: z.string().trim().min(1),
    sourceCharacterId: z.string().trim().min(1),
    sourceVisualId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime(),
    targetGroupId: z.string().trim().min(1),
    expectedPreviewRevision: z.string().trim().min(1).optional(),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, BodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    try {
        return await commitVisualMove(projectRoot, {
            sourceGroupId: body.sourceGroupId,
            sourceCharacterId: body.sourceCharacterId,
            sourceVisualId: body.sourceVisualId,
            expectedUpdatedAt: body.expectedUpdatedAt,
            targetGroupId: body.targetGroupId,
            expectedPreviewRevision: body.expectedPreviewRevision,
        });
    } catch (cause) {
        if (cause instanceof VisualMoveStaleSourceError
            || cause instanceof VisualMoveRevisionConflictError
            || cause instanceof VisualMoveEquivalentConflictError) {
            throw createError({statusCode: 409, message: cause.message});
        }
        if (cause instanceof VisualMoveInvalidTargetError) {
            throw createError({statusCode: 400, message: cause.message});
        }
        throw cause;
    }
});
