import {describe, expect, it, vi} from "vitest";
import {processTextToImageJobs, type TextToImageQueueDependencies} from "nbook/server/text-to-image/queue.processor";
import {TextToImageNovelAiSettingsSchema} from "nbook/shared/dto/text-to-image.dto";
import type {TextToImageJobDto} from "nbook/server/text-to-image/queue.service";

describe("processTextToImageJobs", () => {
    it("按 createdAt 升序处理 queued Job，即使存储返回最新优先", async () => {
        const older = createJob({id: "older", createdAt: "2026-08-03T00:00:00.000Z"});
        const newer = createJob({id: "newer", createdAt: "2026-08-03T00:00:01.000Z"});
        const claimed: string[] = [];
        const deps = createDependencies(older, vi.fn(async () => [new Uint8Array([1])])) as TextToImageQueueDependencies;
        deps.listQueued = vi.fn(async () => [newer, older]);
        deps.markRunning = vi.fn(async (_projectPath, id) => {
            claimed.push(id);
            return true;
        });

        await processTextToImageJobs("workspace/demo", deps);

        expect(claimed).toEqual([older.id, newer.id]);
    });

    it("forwards structured character slots to the NovelAI generator", async () => {
        const job = createJob({
            requestJson: JSON.stringify({
                prompt: "classroom",
                negativePrompt: "bad",
                characterPrompts: [{prompt: "1girl, blue eyes", negativePrompt: "blurry", centerX: 0.3, centerY: 0.5}],
            }),
        });
        const generate = vi.fn(async () => [new Uint8Array([1])]);
        const deps = createDependencies(job, generate);

        await processTextToImageJobs("workspace/demo", deps);

        expect(generate).toHaveBeenCalledWith(expect.objectContaining({
            characterPrompts: [{prompt: "1girl, blue eyes", negativePrompt: "blurry", centerX: 0.3, centerY: 0.5}],
        }));
    });

    it("cleans duplicate tags inside each structured character slot before NovelAI", async () => {
        const job = createJob({
            requestJson: JSON.stringify({
                prompt: "classroom",
                characterPrompts: [{prompt: "1girl, blue eyes, 1girl", negativePrompt: "blurry, blurry"}],
            }),
        });
        const generate = vi.fn(async () => [new Uint8Array([1])]);
        const deps = createDependencies(job, generate);

        await processTextToImageJobs("workspace/demo", deps);

        expect(generate).toHaveBeenCalledWith(expect.objectContaining({
            characterPrompts: [{prompt: "1girl, blue eyes", negativePrompt: "blurry"}],
        }));
    });

    it("keeps request-level dimensions when the active recipe has different dimensions", async () => {
        const job = createJob({
            requestJson: JSON.stringify({
                prompt: "classroom",
                novelAi: {width: 1216, height: 832},
            }),
        });
        const generate = vi.fn(async () => [new Uint8Array([1])]);
        const deps = createDependencies(job, generate, {
            activeGenerationRecipeId: "default",
            generationRecipes: {
                default: {
                    model: "nai-diffusion-4-5-full",
                    sampler: "k_euler",
                    noiseSchedule: "karras",
                    promptGuidance: 10,
                    promptGuidanceRescale: 0.18,
                    aiDefaultCharacterPosition: true,
                    variety: true,
                    decrisp: true,
                    width: 1024,
                    height: 1024,
                    steps: 28,
                    seed: 0,
                    positiveQualityPreset: true,
                    negativeQualityPreset: "Heavy",
                    positive: "",
                    positiveEnd: "",
                    negative: "",
                },
            },
        });

        await processTextToImageJobs("workspace/demo", deps);

        expect(generate).toHaveBeenCalledWith(expect.objectContaining({width: 1216, height: 832}));
    });

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
                credentialRevision: 1,
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

    it("正文 Job 在消费者内写回并推进插入状态", async () => {
        const job = createJob({
            kind: "body",
            sourcePath: "manuscript/chapter-1.md",
            sourceAnchorId: "tti-1",
            sourceInsertStatus: "pending",
        });
        const asset = {relativePath: "assets/tti-1.png"};
        const writeBodyAsset = vi.fn(async () => "inserted" as const);
        const markSourceInserted = vi.fn(async () => true);
        const deps = createDependencies(job, vi.fn(async () => [new Uint8Array([1])])) as TextToImageQueueDependencies;
        deps.saveAsset = vi.fn(async () => asset as never);
        deps.writeBodyAsset = writeBodyAsset;
        deps.markSourceInserted = markSourceInserted;

        await processTextToImageJobs("workspace/demo", deps);

        expect(writeBodyAsset).toHaveBeenCalledWith("workspace/demo", job, asset);
        expect(markSourceInserted).toHaveBeenCalledWith("workspace/demo", job.id);
    });

    it("插入状态投影故障不会把已写回的图片 Job 改报为失败", async () => {
        const job = createJob({
            kind: "body",
            sourcePath: "manuscript/chapter-1.md",
            sourceAnchorId: "tti-1",
            sourceInsertStatus: "pending",
        });
        const markSucceeded = vi.fn(async () => true);
        const deps = createDependencies(job, vi.fn(async () => [new Uint8Array([1])])) as TextToImageQueueDependencies;
        deps.writeBodyAsset = vi.fn(async () => "already_inserted" as const);
        deps.markSourceInserted = vi.fn(async () => {
            throw new Error("状态数据库暂不可用");
        });
        deps.markSucceeded = markSucceeded;

        await processTextToImageJobs("workspace/demo", deps);

        expect(markSucceeded).toHaveBeenCalledWith("workspace/demo", job.id);
        expect(deps.markFailed).not.toHaveBeenCalled();
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
                credentialRevision: 1,
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
                credentialRevision: 1,
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
                credentialRevision: 1,
                settings: TextToImageNovelAiSettingsSchema.parse({}),
            })),
            generate,
            saveAsset: vi.fn(async () => ({} as never)),
        };

        await processTextToImageJobs("workspace/demo", deps);

        expect(generate).not.toHaveBeenCalled();
        expect(deps.markSucceeded).not.toHaveBeenCalled();
    });

    it("Key revision 变化后旧任务稳定失败，不使用新 Key", async () => {
        const job = createJob();
        const markFailed = vi.fn(async () => true);
        const generate = vi.fn(async () => [new Uint8Array([1])]);
        const deps: TextToImageQueueDependencies = {
            listQueued: vi.fn(async () => [job]),
            markRunning: vi.fn(async () => true),
            markSucceeded: vi.fn(async () => true),
            markFailed,
            resolveRuntime: vi.fn(async () => ({credential: "new-token", credentialRevision: 2, settings: TextToImageNovelAiSettingsSchema.parse({})})),
            generate,
            saveAsset: vi.fn(async () => ({} as never)),
        };

        await processTextToImageJobs("workspace/demo", deps);

        expect(generate).not.toHaveBeenCalled();
        expect(markFailed).toHaveBeenCalledWith("workspace/demo", job.id, "Provider API Key 在排队后已变更或删除；请重新提交生图任务");
    });

    it("AQT/UCP 只由本地组装器注入，出站关闭服务端二次追加", async () => {
        const job = createJob();
        const generate = vi.fn(async () => [new Uint8Array([1])]);
        const deps = createDependencies(job, generate, {
            positiveQualityPreset: true,
            negativeQualityPreset: "Heavy",
        });

        await processTextToImageJobs("workspace/demo", deps);

        const call = generate.mock.calls[0]![0];
        expect(call.prompt).toContain("very aesthetic, masterpiece, no text");
        expect(call.negativePrompt).toContain("lowres");
        expect(call.positiveQualityPreset).toBe(false);
        expect(call.ucPreset).toBe(4);
    });
});

function createDependencies(
    job: TextToImageJobDto,
    generate: TextToImageQueueDependencies["generate"],
    settingsInput: Record<string, unknown> = {},
): TextToImageQueueDependencies {
    return {
        listQueued: vi.fn(async () => [job]),
        markRunning: vi.fn(async () => true),
        markSucceeded: vi.fn(async () => true),
        markFailed: vi.fn(async () => true),
        resolveRuntime: vi.fn(async () => ({
            credential: "pst-test",
            credentialRevision: 1,
            settings: TextToImageNovelAiSettingsSchema.parse(settingsInput),
        })),
        generate,
        saveAsset: vi.fn(async () => ({} as never)),
    };
}

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
