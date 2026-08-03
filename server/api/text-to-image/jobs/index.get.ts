import {defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";

const QuerySchema = z.object({
    projectPath: z.string().trim().min(1),
    status: z.enum(["queued", "running", "succeeded", "failed", "canceled"]).optional(),
});

export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const query = QuerySchema.parse(getQuery(event));
    return await new TextToImageQueueService().list(query.projectPath, query.status);
});
