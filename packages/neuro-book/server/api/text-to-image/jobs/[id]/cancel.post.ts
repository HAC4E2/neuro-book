import {defineEventHandler, getQuery, getRouterParam} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";

const QuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = QuerySchema.parse(getQuery(event));
    const id = getRouterParam(event, "id");
    if (!id) throw new Error("缺少 job id");
    const canceled = await new TextToImageQueueService().cancel(`workspace/${query.projectRoot}`, id);
    return {canceled};
});
