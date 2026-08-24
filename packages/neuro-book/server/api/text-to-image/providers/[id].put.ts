import {defineEventHandler, getRouterParam} from "h3";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {SaveTextToImageProviderSchema} from "nbook/server/text-to-image/schemas";

export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const id = Number.parseInt(getRouterParam(event, "id") ?? "", 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Provider id 必须是正整数");
    }
    const body = await validateBody(event, SaveTextToImageProviderSchema);
    return await new TextToImageProviderService().save(user.id, {...body, id});
});
