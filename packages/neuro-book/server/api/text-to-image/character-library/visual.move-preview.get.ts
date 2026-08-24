import {createError, defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {previewVisualMove, VisualMoveInvalidTargetError} from "nbook/server/text-to-image/character-visual-move.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const QuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    sourceGroupId: z.string().trim().min(1),
    sourceCharacterId: z.string().trim().min(1),
    sourceVisualId: z.string().uuid(),
    targetGroupId: z.string().trim().min(1),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = QuerySchema.parse(getQuery(event));
    const projectRoot = resolveTextToImageProjectRoot(query.projectRoot);
    try {
        return await previewVisualMove(projectRoot, {
            sourceGroupId: query.sourceGroupId,
            sourceCharacterId: query.sourceCharacterId,
            sourceVisualId: query.sourceVisualId,
            targetGroupId: query.targetGroupId,
        });
    } catch (cause) {
        if (cause instanceof VisualMoveInvalidTargetError) {
            throw createError({statusCode: 400, message: cause.message});
        }
        throw cause;
    }
});
