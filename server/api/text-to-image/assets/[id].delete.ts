import {createError, getRouterParam} from "h3";
import {z} from "zod";
import {TextToImageAssetReferencedError, TextToImageAssetService} from "nbook/server/text-to-image/asset.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";

const ProjectPathSchema = z.object({projectPath: z.string().trim().min(1)}).strict();

export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const assetId = getRouterParam(event, "id");
    const parsed = ProjectPathSchema.safeParse(await readBody(event));
    if (!assetId || !parsed.success) {
        throw createError({statusCode: 400, message: "删除文生图图片参数不合法"});
    }
    assertProjectOpen(parsed.data.projectPath);
    try {
        await new TextToImageAssetService().delete(parsed.data.projectPath, assetId);
        return {ok: true};
    } catch (error) {
        if (error instanceof TextToImageAssetReferencedError) {
            throw createError({statusCode: 409, data: {code: error.code}, message: error.message});
        }
        throw error;
    }
});
