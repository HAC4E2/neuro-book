import {createError, getRouterParam} from "h3";
import {z} from "zod";
import {createTextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {resolveTextToImageProviderHttpError} from "nbook/server/text-to-image/provider-http-error";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";

const ProjectPathSchema = z.object({projectPath: z.string().trim().min(1)}).strict();

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const jobId = getRouterParam(event, "id");
    const parsed = ProjectPathSchema.safeParse(await readBody(event));
    if (!jobId || !parsed.success) {
        throw createError({statusCode: 400, message: "重试文生图任务参数不合法"});
    }
    assertProjectOpenForRoot(parsed.data.projectPath);
    try {
        return await createTextToImageQueueService(user.id).retry(parsed.data.projectPath, jobId);
    } catch (error) {
        const providerError = resolveTextToImageProviderHttpError(error);
        if (providerError) {
            throw providerError;
        }
        throw error;
    }
});
