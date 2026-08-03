import {defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {listTextToImageAssets} from "nbook/server/text-to-image/asset.service";

const QuerySchema = z.object({
    projectPath: z.string().trim().min(1),
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().optional(),
});

export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const query = QuerySchema.parse(getQuery(event));
    return await listTextToImageAssets({
        projectPath: query.projectPath,
        page: query.page,
        pageSize: query.pageSize,
    });
});
