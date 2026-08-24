import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {CharacterVisualFileSchema} from "nbook/server/text-to-image/character-visual.codec";
import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {validateBody} from "nbook/server/utils/novel-chapter";

const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    baseVisualId: z.string().uuid().optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
    fileName: z.string().trim().optional(),
    visual: CharacterVisualFileSchema,
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, BodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    return await new CharacterVisualLibraryService().createNewVersion(projectRoot, body, body.visual, {
        fileName: body.fileName,
        expectedUpdatedAt: body.expectedUpdatedAt,
        source: "llm",
    });
});
