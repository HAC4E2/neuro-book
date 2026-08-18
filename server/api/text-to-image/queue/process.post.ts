import {defineEventHandler} from "h3";
import {z} from "zod";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {kickTextToImageQueue} from "nbook/server/text-to-image/queue-runtime";

const ProcessBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, ProcessBodySchema);
    const projectPath = `workspace/${body.projectRoot}`;
    const processed = await kickTextToImageQueue(projectPath);
    return {processed};
});
