import {createError} from "h3";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageProviderCreateSchema} from "nbook/server/text-to-image/schemas";
import {requireCurrentUser} from "nbook/server/utils/auth";

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const parsed = TextToImageProviderCreateSchema.safeParse(await readBody(event));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues.map((issue) => issue.message).join("; ") || "Provider 请求参数不合法",
        });
    }
    return await new TextToImageProviderService().create(user.id, parsed.data);
});
