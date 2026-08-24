import {createError, defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {
    listProjectSendDataOptions,
    readProjectSendData,
} from "nbook/server/text-to-image/project-send-data.service";

const ProjectSendDataQuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
}).strict();

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = ProjectSendDataQuerySchema.safeParse(getQuery(event));
    if (!query.success) {
        throw createError({statusCode: 400, message: query.error.issues[0]?.message ?? "Invalid request"});
    }
    const projectRoot = resolveTextToImageProjectRoot(query.data.projectRoot);
    const [sendData, options] = await Promise.all([
        readProjectSendData(projectRoot),
        listProjectSendDataOptions(projectRoot),
    ]);
    return {sendData, ...options};
});
