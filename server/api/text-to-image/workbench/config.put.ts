import {createError, defineEventHandler} from "h3";
import {readConfigEditorSnapshot, saveGlobalConfig} from "nbook/server/config/config-service";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageWorkbenchConfigPutSchema} from "nbook/server/text-to-image/schemas";
import {TextToImageGlobalConfigSchema} from "nbook/shared/dto/text-to-image.dto";

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, TextToImageWorkbenchConfigPutSchema);
    if (body.expectedTextToImageJson !== undefined) {
        const before = await readConfigEditorSnapshot({workspaceKind: "user-assets"});
        const expected = TextToImageGlobalConfigSchema.parse(JSON.parse(body.expectedTextToImageJson) as unknown);
        if (JSON.stringify(expected) !== JSON.stringify(before.global.textToImage)) {
            throw createError({
                statusCode: 409,
                statusMessage: "Text-to-image config conflict",
                message: "文生图配置已被其他窗口修改，请刷新后重试",
            });
        }
    }
    const snapshot = await saveGlobalConfig({textToImage: body.patch}, {workspaceKind: "user-assets"});
    return {
        config: snapshot.global.textToImage,
        providers: await new TextToImageProviderService().list(user.id),
    };
});
