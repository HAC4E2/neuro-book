import {defineEventHandler, getQuery, getRouterParam} from "h3";
import {z} from "zod";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";

const QuerySchema = z.object({
    projectPath: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const query = QuerySchema.parse(getQuery(event));
    const id = getRouterParam(event, "id");
    if (!id) throw new Error("缺少 job id");
    const canceled = await new TextToImageQueueService().cancel(query.projectPath, id);
    return {canceled};
});
