import {readFile} from "node:fs/promises";
import {defineEventHandler, getQuery, send} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {findTextToImageAssetByRelativePath} from "nbook/server/text-to-image/asset.service";
import {resolveTextToImageAssetPath} from "nbook/server/text-to-image/asset-path";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";

const QuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    relativePath: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const query = QuerySchema.parse(getQuery(event));
    const projectPath = `workspace/${query.projectRoot}`;
    const record = await findTextToImageAssetByRelativePath(projectPath, query.relativePath);
    if (!record) {
        throw new Error(`文生图资产不存在：${query.relativePath}`);
    }
    const absolutePath = resolveTextToImageAssetPath(resolveTextToImageProjectRoot(projectPath), record.relativePath);
    return await send(event, await readFile(absolutePath), record.mimeType);
});
