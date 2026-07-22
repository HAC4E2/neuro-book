import {createError, getRouterParam} from "h3";
import {z} from "zod";
import {createTextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";

const ProjectPathSchema = z.object({projectPath: z.string().trim().min(1)}).strict();

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const jobId = getRouterParam(event, "id");
    const parsed = ProjectPathSchema.safeParse(await readBody(event));
    if (!jobId || !parsed.success) {
        throw createError({statusCode: 400, message: "取消文生图任务参数不合法"});
    }
    assertProjectOpen(parsed.data.projectPath);
    return createTextToImageQueueService(user.id).cancel(parsed.data.projectPath, jobId);
});
