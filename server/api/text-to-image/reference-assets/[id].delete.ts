import {createError, getRouterParam} from "h3";
import {z} from "zod";
import {
    TextToImageReferenceAssetInUseError,
    TextToImageReferenceAssetNotFoundError,
    TextToImageReferenceAssetService,
} from "nbook/server/text-to-image/reference-asset.service";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";

const ProjectPathSchema = z.object({projectPath: z.string().trim().min(1)}).strict();

/** 删除未被引用的参考资产；派生 encoding 可直接删，源资产有派生依赖时拒绝。 */
export default defineEventHandler(async (event) => {
    await requireCurrentUser(event);
    const assetId = getRouterParam(event, "id");
    const parsed = ProjectPathSchema.safeParse(await readBody(event));
    if (!assetId || !parsed.success) {
        throw createError({statusCode: 400, message: "删除参考资产参数不合法"});
    }
    assertProjectOpen(parsed.data.projectPath);
    try {
        await new TextToImageReferenceAssetService().delete(parsed.data.projectPath, assetId);
        return {ok: true};
    } catch (error) {
        if (error instanceof TextToImageReferenceAssetInUseError) {
            throw createError({statusCode: 409, data: {code: error.code}, message: error.message});
        }
        if (error instanceof TextToImageReferenceAssetNotFoundError) {
            throw createError({statusCode: 404, data: {code: error.code}, message: error.message});
        }
        throw error;
    }
});
