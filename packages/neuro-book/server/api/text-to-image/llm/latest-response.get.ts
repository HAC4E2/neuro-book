import {defineEventHandler} from "h3";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {textToImageLlmTraceHub} from "nbook/server/text-to-image/llm-trace";

/** 返回当前用户最近一次文生图 LLM 请求的安全调试快照。 */
export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    return {trace: textToImageLlmTraceHub.getLatest(user.id)};
});
