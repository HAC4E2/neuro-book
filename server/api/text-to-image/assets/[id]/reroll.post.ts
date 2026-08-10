import {createError, defineEventHandler, getRouterParam} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {rerollTextToImageAsset} from "nbook/server/text-to-image/asset-postprocess.service";

const RerollBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, RerollBodySchema);
    const assetId = getRouterParam(event, "id") ?? "";
    if (assetId.trim() === "") {
        throw createError({statusCode: 400, message: "资产 ID 不能为空"});
    }
    return await rerollTextToImageAsset({
        projectPath: `workspace/${body.projectRoot}`,
        assetId,
    });
});
