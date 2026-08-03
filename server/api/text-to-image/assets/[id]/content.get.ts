import {readFile} from "node:fs/promises";
import {defineEventHandler, getQuery, getRouterParam, send} from "h3";
import {z} from "zod";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {withEphemeralTextToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {resolveTextToImageAssetPath} from "nbook/server/text-to-image/asset-path";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const QuerySchema = z.object({
    projectPath: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const query = QuerySchema.parse(getQuery(event));
    const id = getRouterParam(event, "id");
    if (!id) throw new Error("缺少 asset id");
    const record = await withEphemeralTextToImageProjectClient(query.projectPath, async (client) => {
        return await client.textToImageAsset.findUnique({where: {id}});
    });
    if (!record) {
        throw new Error("资产不存在");
    }
    const absolutePath = resolveTextToImageAssetPath(resolveTextToImageProjectRoot(query.projectPath), record.relativePath);
    return await send(event, await readFile(absolutePath), record.mimeType);
});
