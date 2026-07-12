import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {requireCurrentUser} from "nbook/server/utils/auth";

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const service = new TextToImageProviderService();
    return {providers: await service.list(user.id)};
});
