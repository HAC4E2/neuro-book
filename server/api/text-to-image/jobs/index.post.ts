import {createError} from "h3";
import {TextToImageJobCreateSchema} from "nbook/server/text-to-image/schemas";
import {createTextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const parsed = TextToImageJobCreateSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({statusCode: 400, message: parsed.error.issues.map((issue) => issue.message).join("; ") || "文生图任务参数不合法"});
    }
    assertProjectOpenForRoot(parsed.data.projectPath);
    return createTextToImageQueueService(user.id).enqueue(parsed.data);
});
