import {defineEventHandler} from "h3";
import {saveGlobalConfig} from "nbook/server/config/config-service";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageWorkbenchConfigPutSchema} from "nbook/server/text-to-image/schemas";

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, TextToImageWorkbenchConfigPutSchema);
    const snapshot = await saveGlobalConfig({textToImage: body}, {workspaceKind: "user-assets"});
    return {
        config: snapshot.global.textToImage,
        providers: await new TextToImageProviderService().list(user.id),
    };
});
