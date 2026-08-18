import {defineEventHandler, getRouterParam} from "h3";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const id = Number.parseInt(getRouterParam(event, "id") ?? "", 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Provider id 必须是正整数");
    }
    return await new TextToImageProviderService().deleteCredential(user.id, id);
});
