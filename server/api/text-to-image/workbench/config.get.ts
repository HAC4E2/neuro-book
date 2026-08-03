import {defineEventHandler} from "h3";
import {readConfigEditorSnapshot} from "nbook/server/config/config-service";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const snapshot = await readConfigEditorSnapshot({workspaceKind: "user-assets"});
    return {
        config: snapshot.global.textToImage,
        providers: await new TextToImageProviderService().list(user.id),
    };
});
