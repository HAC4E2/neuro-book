import {createError, createEventStream} from "h3";
import {pushAgentEvent, readClientVariablesHeader, requireThreadId} from "nbook/server/agent/api";
import {toAgentThreadSnapshotEventDto, toAgentStreamEventDto, useAgentSystem} from "nbook/server/agent/http";

/**
 * 订阅 thread 级长期事件流。
 * 首帧固定同步当前历史与状态，之后持续等待未来事件。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    const eventStream = createEventStream(event);
    const agentSystem = useAgentSystem();
    let streamClosed = false;

    try {
        const clientVariables = readClientVariablesHeader(event);
        if (clientVariables) {
            await agentSystem.syncClientVariables(threadId, clientVariables);
        }
    } catch (error) {
        console.error("[agent] thread stream setup failed", {
            threadId,
        }, error);
        throw error;
    }

    eventStream.onClosed(() => {
        streamClosed = true;
        eventStream.close();
    });

    void (async () => {
        try {
            const subscription = agentSystem.subscribeThreadStream(threadId)[Symbol.asyncIterator]();
            const snapshot = await agentSystem.getThreadSnapshotProjection(threadId);
            if (!snapshot) {
                throw createError({
                    statusCode: 404,
                    message: "线程不存在",
                });
            }
            await pushAgentEvent(eventStream, toAgentThreadSnapshotEventDto(snapshot));

            for await (const agentEvent of { [Symbol.asyncIterator]: () => subscription }) {
                if (agentEvent.type === "thread_snapshot") {
                    continue;
                }
                await pushAgentEvent(eventStream, toAgentStreamEventDto(agentEvent));
            }
        } catch (error) {
            const isAbortError = error instanceof DOMException && error.name === "AbortError";
            if (!isAbortError) {
                console.error("[agent] thread stream failed", {
                    threadId,
                }, error);
                if (!streamClosed) {
                    await pushAgentEvent(eventStream, {
                        type: "run_state",
                        threadId,
                        status: "failed",
                        error: error instanceof Error ? error.message : "Agent thread stream 失败",
                    });
                }
            }
        } finally {
            streamClosed = true;
            await eventStream.close();
        }
    })();

    return eventStream.send();
});
