import {createError, defineEventHandler, getRouterParam} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {inpaintTextToImageAsset} from "nbook/server/text-to-image/asset-postprocess.service";

const InpaintBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    maskBase64: z.string().trim().min(1),
    strength: z.number().min(0).max(1).optional(),
    newPrompt: z.string().optional(),
});

export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, InpaintBodySchema);
    const assetId = getRouterParam(event, "id") ?? "";
    if (assetId.trim() === "") {
        throw createError({statusCode: 400, message: "资产 ID 不能为空"});
    }
    return await inpaintTextToImageAsset({
        projectPath: `workspace/${body.projectRoot}`,
        assetId,
        maskBase64: body.maskBase64,
        strength: body.strength,
        newPrompt: body.newPrompt,
    });
});
