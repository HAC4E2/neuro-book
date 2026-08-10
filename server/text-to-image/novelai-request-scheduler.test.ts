import {describe, expect, it, vi} from "vitest";
import {NovelAiRequestScheduler} from "nbook/server/text-to-image/novelai-request-scheduler";

describe("NovelAiRequestScheduler", () => {
    it("按入队顺序串行执行，并在上一项完成后等待生图间隔", async () => {
        vi.useFakeTimers();
        try {
            const scheduler = new NovelAiRequestScheduler();
            const events: string[] = [];
            let releaseFirst!: () => void;
            const first = scheduler.schedule({
                requestIntervalMs: 15_000,
                run: async () => {
                    events.push("first:start");
                    await new Promise<void>((resolve) => {
                        releaseFirst = resolve;
                    });
                    events.push("first:end");
                    return "first";
                },
            });
            const second = scheduler.schedule({
                requestIntervalMs: 15_000,
                run: async () => {
                    events.push("second:start");
                    return "second";
                },
            });

            await vi.advanceTimersByTimeAsync(0);
            expect(events).toEqual(["first:start"]);

            releaseFirst();
            await expect(first).resolves.toBe("first");
            expect(events).toEqual(["first:start", "first:end"]);

            await vi.advanceTimersByTimeAsync(14_999);
            expect(events).toEqual(["first:start", "first:end"]);
            await vi.advanceTimersByTimeAsync(1);
            await expect(second).resolves.toBe("second");
            expect(events).toEqual(["first:start", "first:end", "second:start"]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("429 只失败当前项，不自动重试，但仍为下一项启动冷却", async () => {
        vi.useFakeTimers();
        try {
            const scheduler = new NovelAiRequestScheduler();
            let attempts = 0;
            const first = scheduler.schedule({
                requestIntervalMs: 15_000,
                run: async () => {
                    attempts += 1;
                    throw new Error("NovelAI HTTP 429");
                },
            });
            const second = scheduler.schedule({
                requestIntervalMs: 15_000,
                run: async () => "second",
            });

            await expect(first).rejects.toThrow("429");
            expect(attempts).toBe(1);
            await vi.advanceTimersByTimeAsync(14_999);
            expect(await Promise.race([second.then(() => "done"), Promise.resolve("pending")])).toBe("pending");
            await vi.advanceTimersByTimeAsync(1);
            await expect(second).resolves.toBe("second");
            expect(attempts).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("尚未开始的队列项取消后不会执行，也不启动冷却", async () => {
        vi.useFakeTimers();
        try {
            const scheduler = new NovelAiRequestScheduler();
            const controller = new AbortController();
            const first = scheduler.schedule({
                requestIntervalMs: 15_000,
                run: async () => "first",
            });
            const second = scheduler.schedule({
                requestIntervalMs: 15_000,
                signal: controller.signal,
                run: async () => "second",
            });
            controller.abort();

            await expect(first).resolves.toBe("first");
            await expect(second).rejects.toMatchObject({name: "AbortError"});
        } finally {
            vi.useRealTimers();
        }
    });
});
