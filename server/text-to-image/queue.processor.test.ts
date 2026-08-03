import {describe, expect, it, vi} from "vitest";
import {processTextToImageJobs, type TextToImageQueueDependencies} from "nbook/server/text-to-image/queue.processor";
import {TextToImageNovelAiSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import type {TextToImageJobDto} from "nbook/server/text-to-image/queue.service";

describe("processTextToImageJobs", () => {
    it("消费 queued job：生成、存资产、标记成功", async () => {
        const job = createJob();
        const markSucceeded = vi.fn(async () => true);
        const saveAsset = vi.fn(async () => ({}));
        const deps: TextToImageQueueDependencies = {
            listQueued: vi.fn(async () => [job]),
            markRunning: vi.fn(async () => true),
            markSucceeded,
            markFailed: vi.fn(async () => true),
            resolveRuntime: vi.fn(async () => ({
                credential: "pst-test",
                settings: TextToImageNovelAiSettingsSchema.parse({}),
            })),
            generate: vi.fn(async () => [new Uint8Array([1, 2, 3])]),
            saveAsset,
        };

        const processed = await processTextToImageJobs("workspace/demo", deps);

        expect(processed).toBe(1);
        expect(markSucceeded).toHaveBeenCalledWith("workspace/demo", job.id);
        expect(saveAsset).toHaveBeenCalledWith(expect.objectContaining({
            jobId: job.id,
            mimeType: "image/png",
            prompt: expect.stringContaining("1girl"),
            sourceKind: "manual",
        }));
    });

    it("生成失败时标记 failed 并继续下一个 job", async () => {
        const first = createJob({id: "j1"});
        const second = createJob({id: "j2"});
        const markFailed = vi.fn(async () => true);
        const markSucceeded = vi.fn(async () => true);
        const deps: TextToImageQueueDependencies = {
            listQueued: vi.fn(async () => [first, second]),
            markRunning: vi.fn(async () => true),
            markSucceeded,
            markFailed,
            resolveRuntime: vi.fn(async () => ({
                credential: "pst-test",
                settings: TextToImageNovelAiSettingsSchema.parse({}),
            })),
            generate: vi.fn(async () => {
                throw new Error("生成失败");
            }),
            saveAsset: vi.fn(async () => ({} as never)),
        };

        const processed = await processTextToImageJobs("workspace/demo", deps);

        expect(processed).toBe(2);
        expect(markFailed).toHaveBeenCalledTimes(2);
        expect(markFailed).toHaveBeenCalledWith("workspace/demo", "j1", "生成失败");
        expect(markSucceeded).not.toHaveBeenCalled();
    });
});

function createJob(overrides: Partial<TextToImageJobDto> = {}): TextToImageJobDto {
    return {
        id: "j1",
        projectPath: "workspace/demo",
        providerId: 1,
        providerOwnerUserId: 7,
        providerCredentialRevision: 1,
        kind: "manual",
        status: "queued",
        requestJson: JSON.stringify({prompt: "1girl", negativePrompt: "bad"}),
        sourcePath: null,
        sourceAnchorId: null,
        sourceInsertStatus: "not_applicable",
        errorMessage: null,
        attemptCount: 0,
        createdAt: "2026-08-03T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
        ...overrides,
    };
}
