import {defineEventHandler} from "h3";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {requireCurrentUser} from "nbook/server/utils/auth";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {SaveTextToImageProviderSchema} from "nbook/server/text-to-image/schemas";

export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, SaveTextToImageProviderSchema);
    return await new TextToImageProviderService().save(user.id, body);
});
