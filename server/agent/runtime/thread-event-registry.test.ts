import {describe, expect, it} from "vitest";
import {ThreadEventRegistry} from "nbook/server/agent/runtime/thread-event-registry";

describe("ThreadEventRegistry", () => {
    it("只向订阅之后的消费者广播未来事件", async () => {
        const registry = new ThreadEventRegistry();
        registry.publish("thread-1", {
            type: "run_state",
            threadId: "thread-1",
            status: "running",
        });

        const iterator = registry.subscribe("thread-1")[Symbol.asyncIterator]();
        const channel = (registry as unknown as {
            channels: Map<string, {subscribers: Set<{buffered: unknown[]}>}>;
        }).channels.get("thread-1");
        const queue = channel ? [...channel.subscribers][0] : null;
        expect(queue?.buffered ?? []).toHaveLength(0);

        registry.publish("thread-1", {
            type: "run_state",
            threadId: "thread-1",
            status: "completed",
        });

        const event = await iterator.next();
        expect(event.done).toBe(false);
        expect(event.value).toMatchObject({
            type: "run_state",
            status: "completed",
        });
    });

    it("订阅关闭后会清理空 channel", async () => {
        const registry = new ThreadEventRegistry();
        const iterator = registry.subscribe("thread-1")[Symbol.asyncIterator]();

        expect((registry as unknown as {channels: Map<string, unknown>}).channels.size).toBe(1);
        await iterator.return?.();
        expect((registry as unknown as {channels: Map<string, unknown>}).channels.size).toBe(0);
    });
});
