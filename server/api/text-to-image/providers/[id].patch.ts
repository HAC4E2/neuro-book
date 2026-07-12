import {createError} from "h3";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageProviderIdSchema, TextToImageProviderPatchSchema} from "nbook/server/text-to-image/schemas";
import {requireCurrentUser} from "nbook/server/utils/auth";

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const providerId = TextToImageProviderIdSchema.safeParse(event.context.params?.id);
    const parsed = TextToImageProviderPatchSchema.safeParse(await readBody(event));
    if (!providerId.success || !parsed.success) {
        throw createError({
            statusCode: 400,
            message: "Provider 请求参数不合法",
        });
    }
    return await new TextToImageProviderService().update(user.id, providerId.data, parsed.data);
});
