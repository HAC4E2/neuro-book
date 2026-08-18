import {createEventStream, defineEventHandler} from "h3";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {textToImageLlmTraceHub} from "nbook/server/text-to-image/llm-trace";
import {isClosingEventStreamError} from "nbook/server/utils/event-stream";

/** 当前用户文生图 LLM 原始回复事件流；断开只取消观察，不取消业务请求。 */
export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const eventStream = createEventStream(event);
    let closed = false;
    let unsubscribe: () => void = () => undefined;
    const finish = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        void eventStream.close().catch(() => undefined);
    };
    const push = async (payload: unknown): Promise<void> => {
        if (closed) return;
        try {
            await eventStream.push({event: "llm", data: JSON.stringify(payload)});
        } catch (error) {
            if (isClosingEventStreamError(error)) {
                finish();
                return;
            }
            throw error;
        }
    };
    eventStream.onClosed(() => {
        finish();
        return undefined;
    });
    unsubscribe = textToImageLlmTraceHub.subscribe(user.id, (payload) => {
        void push(payload).catch(() => finish());
        return undefined;
    });
    return eventStream.send();
});
