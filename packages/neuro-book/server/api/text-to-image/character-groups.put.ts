import {defineEventHandler} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {updateCharacterGroup} from "nbook/server/text-to-image/character-visual.service";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {validateBody} from "nbook/server/utils/novel-chapter";

const CharacterGroupUpdateBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    groupId: z.string().trim().min(1),
    name: z.string().trim().optional(),
    description: z.string().trim().optional(),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, CharacterGroupUpdateBodySchema);
    return {
        group: await updateCharacterGroup(
            resolveTextToImageProjectRoot(body.projectRoot),
            body.groupId,
            {
                name: body.name,
                description: body.description,
            },
        ),
    };
});
