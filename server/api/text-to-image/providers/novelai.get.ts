import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {requireCurrentUser} from "nbook/server/utils/auth";

/** 只读返回当前用户 NovelAI singleton/preflight 状态。 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    return await new TextToImageProviderService().inspectNovelAi(user.id);
});
