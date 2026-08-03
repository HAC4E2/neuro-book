import {defineEventHandler, getRouterParam} from "h3";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const id = Number.parseInt(getRouterParam(event, "id") ?? "", 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Provider id 必须是正整数");
    }
    return await new TextToImageProviderService().remove(user.id, id);
});
