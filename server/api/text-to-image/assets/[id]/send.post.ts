import {createError, defineEventHandler, getRouterParam} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {sendTextToImageAsset} from "nbook/server/text-to-image/asset-postprocess.service";

const SendBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
});

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, SendBodySchema);
    const assetId = getRouterParam(event, "id") ?? "";
    if (assetId.trim() === "") {
        throw createError({statusCode: 400, message: "资产 ID 不能为空"});
    }
    return await sendTextToImageAsset({
        projectPath: `workspace/${body.projectRoot}`,
        assetId,
        userId: user.id,
        prompt: body.prompt,
    });
});
