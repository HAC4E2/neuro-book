import {defineEventHandler} from "h3";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    return await new TextToImageProviderService().list(user.id);
});
