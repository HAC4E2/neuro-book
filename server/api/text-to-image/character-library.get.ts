import {defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {CharacterVisualLibraryService} from "nbook/server/text-to-image/character-visual-library.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const QuerySchema = z.object({projectRoot: z.string().trim().min(1)}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = QuerySchema.parse(getQuery(event));
    const projectRoot = resolveTextToImageProjectRoot(query.projectRoot);
    return {groups: await new CharacterVisualLibraryService().listTree(projectRoot)};
});
