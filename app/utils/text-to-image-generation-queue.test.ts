import {describe, expect, it, vi} from "vitest";
import {
    enqueueTextToImageGeneration,
    getTextToImageGenerationQueueSnapshot,
    subscribeTextToImageGenerationQueue,
} from "nbook/app/utils/text-to-image-generation-queue";

describe("text-to-image generation queue", () => {
    it("publishes queued, running, and completed job snapshots", async () => {
        vi.useFakeTimers();
        const globals = globalThis as typeof globalThis & {window?: {setTimeout: typeof setTimeout}};
        globals.window = {setTimeout};
        const snapshots: string[][] = [];
        const unsubscribe = subscribeTextToImageGenerationQueue((snapshot) => {
            snapshots.push(snapshot.jobs.map((job) => `${job.label}:${job.status}:${job.position}`));
        });
        let finishFirst: ((value: string) => void) | null = null;

        const first = enqueueTextToImageGeneration({
            id: "first",
            label: "正文插图 A",
            run: () => new Promise<string>((resolve) => {
                finishFirst = resolve;
            }),
        });
        const second = enqueueTextToImageGeneration({
            id: "second",
            label: "正文插图 B",
            run: async () => "second-done",
        });

        expect(getTextToImageGenerationQueueSnapshot().jobs.map((job) => ({
            id: job.id,
            label: job.label,
            status: job.status,
            position: job.position,
        }))).toEqual([
            {id: "first", label: "正文插图 A", status: "running", position: 1},
            {id: "second", label: "正文插图 B", status: "queued", position: 2},
        ]);

        finishFirst?.("first-done");
        await expect(first).resolves.toBe("first-done");
        await vi.advanceTimersByTimeAsync(15_000);
        await expect(second).resolves.toBe("second-done");

        expect(getTextToImageGenerationQueueSnapshot().jobs.map((job) => `${job.id}:${job.status}`)).toEqual([
            "second:done",
            "first:done",
        ]);
        expect(snapshots.some((snapshot) => snapshot.includes("正文插图 B:running:1"))).toBe(true);
        unsubscribe();
        vi.useRealTimers();
    });
});
