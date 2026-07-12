import {createError} from "h3";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageProviderIdSchema} from "nbook/server/text-to-image/schemas";
import {requireCurrentUser} from "nbook/server/utils/auth";

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const providerId = TextToImageProviderIdSchema.safeParse(event.context.params?.id);
    if (!providerId.success) {
        throw createError({statusCode: 400, message: "Provider ID 不合法"});
    }
    await new TextToImageProviderService().delete(user.id, providerId.data);
    return {deleted: true};
});
