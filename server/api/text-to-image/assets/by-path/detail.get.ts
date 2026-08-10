import {defineEventHandler, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {findTextToImageAssetByRelativePath} from "nbook/server/text-to-image/asset.service";

const QuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    relativePath: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = QuerySchema.parse(getQuery(event));
    const asset = await findTextToImageAssetByRelativePath(
        `workspace/${query.projectRoot}`,
        query.relativePath,
    );
    if (!asset) {
        throw new Error(`文生图资产不存在：${query.relativePath}`);
    }
    return asset;
});
