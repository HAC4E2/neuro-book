import {defineEventHandler} from "h3";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    return await new TextToImageProviderService().list(user.id);
});
