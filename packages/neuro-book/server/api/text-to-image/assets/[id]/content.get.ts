import {readFile} from "node:fs/promises";
import {defineEventHandler, getQuery, getRouterParam, send} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {withEphemeralTextToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {resolveTextToImageAssetPath} from "nbook/server/text-to-image/asset-path";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const QuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = QuerySchema.parse(getQuery(event));
    const id = getRouterParam(event, "id");
    if (!id) throw new Error("缺少 asset id");
    const record = await withEphemeralTextToImageProjectClient(`workspace/${query.projectRoot}`, async (client) => {
        return await client.textToImageAsset.findUnique({where: {id}});
    });
    if (!record) {
        throw new Error("资产不存在");
    }
    const absolutePath = resolveTextToImageAssetPath(resolveTextToImageProjectRoot(query.projectRoot), record.relativePath);
    return await send(event, await readFile(absolutePath), record.mimeType);
});
