import {defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {listTextToImageAssets} from "nbook/server/text-to-image/asset.service";

const QuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().optional(),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = QuerySchema.parse(getQuery(event));
    return await listTextToImageAssets({
        projectPath: `workspace/${query.projectRoot}`,
        page: query.page,
        pageSize: query.pageSize,
    });
});
