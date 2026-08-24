import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {validateBody} from "nbook/server/utils/novel-chapter";

const BodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    enabledGroupIds: z.array(z.string().trim().min(1)).max(128),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, BodySchema);
    const projectRoot = resolveTextToImageProjectRoot(body.projectRoot);
    return {groups: await new CharacterVisualLibraryService().setEnabledGroups(projectRoot, body.enabledGroupIds)};
});
