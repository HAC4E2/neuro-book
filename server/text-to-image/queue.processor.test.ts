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

    it("uses a persisted final prompt without adding fixed prompts or quality presets again", async () => {
        const job = createJob({
            requestJson: JSON.stringify({
                prompt: "final, character, scene",
                negativePrompt: "final negative",
                useFinalPrompt: true,
                novelAi: {
                    fixedPositivePrompt: "should not be added",
                    fixedPositivePromptEnd: "should not be added",
                    fixedNegativePrompt: "should not be added",
                    positiveQualityPreset: true,
                    negativeQualityPreset: "Heavy",
                },
            }),
        });
        const generate = vi.fn(async () => [new Uint8Array([1, 2, 3])]);
        const deps: TextToImageQueueDependencies = {
            listQueued: vi.fn(async () => [job]),
            markRunning: vi.fn(async () => true),
            markSucceeded: vi.fn(async () => true),
            markFailed: vi.fn(async () => true),
            resolveRuntime: vi.fn(async () => ({
                credential: "pst-test",
                settings: TextToImageNovelAiSettingsSchema.parse({
                    fixedPositivePrompt: "runtime positive",
                    fixedPositivePromptEnd: "runtime ending",
                    fixedNegativePrompt: "runtime negative",
                    positiveQualityPreset: true,
                    negativeQualityPreset: "Heavy",
                }),
            })),
            generate,
            saveAsset: vi.fn(async () => ({})),
        };

        await processTextToImageJobs("workspace/demo", deps);

        expect(generate).toHaveBeenCalledWith(expect.objectContaining({
            prompt: "final, character, scene",
            negativePrompt: "final negative",
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

    it("并发消费时只有成功 markRunning 的 Job 才能发送 NovelAI", async () => {
        const job = createJob({id: "j-race"});
        const generate = vi.fn(async () => [new Uint8Array([1])]);
        const deps: TextToImageQueueDependencies = {
            listQueued: vi.fn(async () => [job]),
            markRunning: vi.fn(async () => false),
            markSucceeded: vi.fn(async () => true),
            markFailed: vi.fn(async () => true),
            resolveRuntime: vi.fn(async () => ({
                credential: "pst-test",
                settings: TextToImageNovelAiSettingsSchema.parse({}),
            })),
            generate,
            saveAsset: vi.fn(async () => ({} as never)),
        };

        await processTextToImageJobs("workspace/demo", deps);

        expect(generate).not.toHaveBeenCalled();
        expect(deps.markSucceeded).not.toHaveBeenCalled();
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
