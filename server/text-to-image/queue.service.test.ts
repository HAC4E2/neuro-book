import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    abortTextToImageProviderAttempts,
    TextToImageQueueService,
} from "nbook/server/text-to-image/queue.service";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";
import {createDefaultTextToImageRecipeSource, getActiveTextToImageRecipeStyle} from "nbook/shared/text-to-image-recipe";
import {createTextToImageRecipeSnapshot} from "nbook/server/text-to-image/recipe.codec";
import type {TextToImageProviderSnapshotDto} from "nbook/shared/dto/text-to-image.dto";

describe("TextToImageQueueService", () => {
    let assets: IsolatedWorkspaceAssets;
    let projectPath: string;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        assets = await createIsolatedWorkspaceAssets();
        projectPath = `workspace/text-to-image-queue-${randomUUID()}`;
        await writeProjectManifest(resolveRuntimeWorkspaceRoot(), projectPath, {kind: "novel", title: "队列测试", summary: ""});
        await openProjectForTest(projectPath);
    }, 30_000);

    afterEach(async () => {
        await closeProjectForTest(projectPath).catch(() => undefined);
        resetProjectSessionsForTest();
        await assets?.dispose();
    }, 30_000);

    it("在远端调用前持久化 queued 任务", async () => {
        const request = vi.fn(() => new Promise<never>(() => undefined));
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => {
                throw new Error("本测试不应保存图片");
            },
        });

        const job = await service.enqueue({
            projectPath,
            providerId: 9,
            kind: "manual",
            prompt: "1girl",
            negativePrompt: "bad anatomy",
            novelAi: baseNovelAiInput(),
            style: baseStyleInput(),
            recipeSnapshot: baseRecipeSnapshot(),
        });

        const stored = await (await textToImageProjectClient(projectPath)).textToImageJob.findUnique({where: {id: job.id}});
        expect(stored).toMatchObject({
            providerId: 9,
            status: "queued",
            providerSnapshotJson: JSON.stringify(providerSnapshot(9)),
            requestJson: expect.not.stringMatching(/secret|data:image/),
        });
        expect(request).not.toHaveBeenCalled();
    });

    it("拒绝与 Recipe snapshot 不一致的内部编译参数", async () => {
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: async () => ({images: [], request: {model: "should-not-run", seed: 1}, warnings: []}),
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => {
                throw new Error("本测试不应保存图片");
            },
        });

        await expect(service.enqueue({
            projectPath,
            providerId: 9,
            kind: "manual",
            prompt: "mismatch",
            negativePrompt: "",
            novelAi: {...baseNovelAiInput(), model: "agent-forged-model"},
            style: baseStyleInput(),
            recipeSnapshot: baseRecipeSnapshot(),
        })).rejects.toThrow("Recipe snapshot");
        await expect((await textToImageProjectClient(projectPath)).textToImageJob.count()).resolves.toBe(0);
    });

    it("手工请求的 Recipe snapshot 携带参考资源时 fail-closed 拒绝", async () => {
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: async () => ({images: [], request: {model: "should-not-run", seed: 1}, warnings: []}),
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => {
                throw new Error("本测试不应保存图片");
            },
        });
        const recipeSnapshot = createTextToImageRecipeSnapshot({
            ...createDefaultTextToImageRecipeSource(),
            references: {
                normalizeVibeStrengths: true,
                vibeReferences: [{contentHash: "a".repeat(64), strength: 0.6, informationExtracted: 0.5}],
                characterReferences: [],
                inpaint: null,
            },
        });

        await expect(service.enqueue({
            projectPath,
            providerId: 9,
            kind: "manual",
            prompt: "rain",
            negativePrompt: "",
            novelAi: baseNovelAiInput(),
            style: baseStyleInput(),
            recipeSnapshot,
        })).rejects.toThrow(/不允许携带参考资源/u);
        await expect((await textToImageProjectClient(projectPath)).textToImageJob.count()).resolves.toBe(0);
    });

    it("持久化完整 Recipe snapshot，且 Provider 不覆盖 Recipe 图片模型", async () => {
        const request = vi.fn(async () => ({images: [], request: {model: "recipe-owned-model", seed: 1}, warnings: []}));
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => {
                throw new Error("本测试不应保存图片");
            },
        });
        const recipeSnapshot = createTextToImageRecipeSnapshot({
            ...createDefaultTextToImageRecipeSource(),
            model: "recipe-owned-model",
        });

        const job = await service.enqueue({
            projectPath,
            providerId: 9,
            kind: "manual",
            prompt: "recipe model",
            negativePrompt: "",
            novelAi: {...baseNovelAiInput(), model: "recipe-owned-model"},
            style: baseStyleInput(),
            recipeSnapshot,
        });

        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
        expect(request).toHaveBeenCalledWith(expect.objectContaining({
            novelAi: expect.objectContaining({model: "recipe-owned-model"}),
            recipeSnapshot: expect.objectContaining({recipeSourceHash: recipeSnapshot.recipeSourceHash}),
        }), "secret", expect.any(AbortSignal));
        const stored = await (await textToImageProjectClient(projectPath)).textToImageJob.findUnique({where: {id: job.id}});
        expect(JSON.parse(stored?.requestJson ?? "{}")).toMatchObject({
            recipeSnapshot: {recipeSourceHash: recipeSnapshot.recipeSourceHash},
        });
    });

    it("同一 Project 与 Provider 串行执行任务", async () => {
        const first = deferred<void>();
        const request = vi.fn(async () => {
            await first.promise;
            return {images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []};
        });
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => {
                throw new Error("本测试不应保存图片");
            },
            wait: async () => undefined,
        });

        await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "first", negativePrompt: "", novelAi: baseNovelAiInput(), style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()});
        await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "second", negativePrompt: "", novelAi: baseNovelAiInput(), style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()});
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

        first.resolve();
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    });

    it("恢复时中断旧 running 任务，并重新调度 queued 任务", async () => {
        const request = vi.fn(async () => ({images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []}));
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => {
                throw new Error("本测试不应保存图片");
            },
        });
        const client = await textToImageProjectClient(projectPath);
        const runningId = randomUUID();
        const queuedId = randomUUID();
        await client.textToImageJob.createMany({
            data: [
                jobRecord(runningId, "running"),
                jobRecord(queuedId, "queued"),
            ],
        });

        await service.recoverProject(projectPath);

        await expect(client.textToImageJob.findUnique({where: {id: runningId}})).resolves.toMatchObject({status: "interrupted"});
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
        await expect(client.textToImageJob.findUnique({where: {id: queuedId}})).resolves.toMatchObject({status: "succeeded"});
    });

    it("取消使用 CAS，不覆盖读取后被 reconciliation 写入的 outcome_unknown", async () => {
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: async () => ({images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []}),
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => ({id: "must-not-exist"}),
        });
        const client = await textToImageProjectClient(projectPath);
        const jobId = randomUUID();
        await client.textToImageJob.create({data: jobRecord(jobId, "running")});
        const originalUpdateMany = client.textToImageJob.updateMany.bind(client.textToImageJob);
        vi.spyOn(client.textToImageJob, "updateMany").mockImplementationOnce(async (args) => {
            await client.textToImageJob.update({
                where: {id: jobId},
                data: {status: "outcome_unknown", finishedAt: new Date(), errorMessage: "migration terminal"},
            });
            return await originalUpdateMany(args);
        });

        await expect(service.cancel(projectPath, jobId)).resolves.toMatchObject({
            status: "outcome_unknown",
            errorMessage: "migration terminal",
        });
        await expect(client.textToImageJob.findUnique({where: {id: jobId}})).resolves.toMatchObject({status: "outcome_unknown"});
    });

    it("取消使用 CAS，不覆盖远端响应已领取的 completing 完成权", async () => {
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: async () => ({images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []}),
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => ({id: "must-not-exist"}),
        });
        const client = await textToImageProjectClient(projectPath);
        const jobId = randomUUID();
        await client.textToImageJob.create({data: jobRecord(jobId, "running")});
        const originalUpdateMany = client.textToImageJob.updateMany.bind(client.textToImageJob);
        vi.spyOn(client.textToImageJob, "updateMany").mockImplementationOnce(async (args) => {
            await client.textToImageJob.update({where: {id: jobId}, data: {status: "completing"}});
            return await originalUpdateMany(args);
        });

        await expect(service.cancel(projectPath, jobId)).resolves.toMatchObject({status: "completing"});
        await expect(client.textToImageJob.findUnique({where: {id: jobId}})).resolves.toMatchObject({status: "completing"});
    });

    it("领取 queued 执行权使用 CAS，不覆盖 reconciliation 已写入的 configuration_stale", async () => {
        const resolving = deferred<void>();
        const releaseProvider = deferred<void>();
        const request = vi.fn(async () => ({images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []}));
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: request,
            resolveProvider: async () => {
                resolving.resolve();
                await releaseProvider.promise;
                return {credential: "secret", requestIntervalMs: 0};
            },
            saveAsset: async () => ({id: "must-not-exist"}),
        });
        const job = await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "claim race", negativePrompt: "", novelAi: baseNovelAiInput(), style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()});
        await resolving.promise;
        const client = await textToImageProjectClient(projectPath);
        await client.textToImageJob.updateMany({
            where: {id: job.id, status: "queued"},
            data: {status: "configuration_stale", finishedAt: new Date(), errorMessage: "migration terminal"},
        });

        releaseProvider.resolve();

        await vi.waitFor(async () => {
            await expect(client.textToImageJob.findUnique({where: {id: job.id}})).resolves.toMatchObject({
                status: "configuration_stale",
                attemptCount: 0,
            });
        });
        expect(request).not.toHaveBeenCalled();
    });

    it("Provider reconciliation 的 outcome_unknown 终态不会被 Queue catch 覆盖或自动重试", async () => {
        const started = deferred<void>();
        const request = vi.fn(async (_input: object, _credential: string, signal: AbortSignal) => {
            started.resolve();
            await new Promise<void>((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {once: true});
            });
            throw new Error("unreachable");
        });
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => {
                throw new Error("本测试不应保存图片");
            },
        });
        const job = await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "unknown", negativePrompt: "", novelAi: baseNovelAiInput(), style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()});
        await started.promise;
        const client = await textToImageProjectClient(projectPath);
        await client.textToImageJob.update({
            where: {id: job.id},
            data: {status: "outcome_unknown", finishedAt: new Date(), errorMessage: "migration terminal"},
        });

        abortTextToImageProviderAttempts([9]);

        await vi.waitFor(async () => {
            await expect(client.textToImageJob.findUnique({where: {id: job.id}})).resolves.toMatchObject({
                status: "outcome_unknown",
                errorMessage: "migration terminal",
                attemptCount: 1,
            });
        });
        expect(request).toHaveBeenCalledTimes(1);
    });

    it("Provider reconciliation 后晚到的远端成功响应不能覆盖 outcome_unknown", async () => {
        const started = deferred<void>();
        const response = deferred<void>();
        const request = vi.fn(async () => {
            started.resolve();
            await response.promise;
            return {
                images: [{bytes: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png" as const, width: 832, height: 1216, seed: 1}],
                request: {model: "nai-diffusion-4-5-full", seed: 1},
                warnings: [],
            };
        });
        const saveAsset = vi.fn(async () => ({id: "must-not-exist"}));
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset,
        });
        const job = await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "late success", negativePrompt: "", novelAi: baseNovelAiInput(), style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()});
        await started.promise;
        const client = await textToImageProjectClient(projectPath);
        await client.textToImageJob.update({
            where: {id: job.id},
            data: {status: "outcome_unknown", finishedAt: new Date(), errorMessage: "migration terminal"},
        });

        response.resolve();

        await vi.waitFor(async () => {
            await expect(client.textToImageJob.findUnique({where: {id: job.id}})).resolves.toMatchObject({
                status: "outcome_unknown",
                errorMessage: "migration terminal",
            });
        });
        expect(request).toHaveBeenCalledTimes(1);
        expect(saveAsset).not.toHaveBeenCalled();
    });

    it("远端响应领取 completing 写权后，reconciliation 不再把已知结果改为 outcome_unknown", async () => {
        const saveStarted = deferred<void>();
        const releaseSave = deferred<void>();
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: async () => ({
                images: [{bytes: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png", width: 832, height: 1216, seed: 1}],
                request: {model: "nai-diffusion-4-5-full", seed: 1},
                warnings: [],
            }),
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => {
                saveStarted.resolve();
                await releaseSave.promise;
                return {id: "asset-after-fence"};
            },
        });
        const job = await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "known response", negativePrompt: "", novelAi: baseNovelAiInput(), style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()});
        await saveStarted.promise;
        const client = await textToImageProjectClient(projectPath);

        await expect(client.textToImageJob.findUnique({where: {id: job.id}})).resolves.toMatchObject({status: "completing"});
        const reconciliation = await client.textToImageJob.updateMany({
            where: {id: job.id, status: "running"},
            data: {status: "outcome_unknown"},
        });
        expect(reconciliation.count).toBe(0);

        releaseSave.resolve();
        await vi.waitFor(async () => {
            await expect(client.textToImageJob.findUnique({where: {id: job.id}})).resolves.toMatchObject({
                status: "succeeded",
                resultAssetIdsJson: "[\"asset-after-fence\"]",
            });
        });
    });

    it("批量图片保存中途失败时补偿删除已保存资产，并让失败 Job 保持空结果", async () => {
        const deleteAsset = vi.fn(async () => undefined);
        const saveAsset = vi.fn()
            .mockResolvedValueOnce({id: "asset-1"})
            .mockRejectedValueOnce(new Error("second asset failed"));
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset,
            requestImages: async () => ({
                images: [
                    {bytes: new Uint8Array([1]), mimeType: "image/png", width: 832, height: 1216, seed: 1},
                    {bytes: new Uint8Array([2]), mimeType: "image/png", width: 832, height: 1216, seed: 2},
                ],
                request: {model: "nai-diffusion-4-5-full", seed: 1},
                warnings: [],
            }),
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset,
        });

        const job = await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "two images", negativePrompt: "", novelAi: {...baseNovelAiInput(), count: 2}, style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()});
        const client = await textToImageProjectClient(projectPath);

        await vi.waitFor(async () => {
            await expect(client.textToImageJob.findUnique({where: {id: job.id}})).resolves.toMatchObject({
                status: "failed",
                resultAssetIdsJson: "[]",
            });
        });
        expect(saveAsset).toHaveBeenCalledTimes(2);
        expect(deleteAsset).toHaveBeenCalledWith(projectPath, "asset-1");
    });

    it("补偿删除失败时把仍存在的部分资产 ID 保留在失败 Job", async () => {
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => {
                throw new Error("asset delete failed");
            },
            requestImages: async () => ({
                images: [
                    {bytes: new Uint8Array([1]), mimeType: "image/png", width: 832, height: 1216, seed: 1},
                    {bytes: new Uint8Array([2]), mimeType: "image/png", width: 832, height: 1216, seed: 2},
                ],
                request: {model: "nai-diffusion-4-5-full", seed: 1},
                warnings: [],
            }),
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: vi.fn()
                .mockResolvedValueOnce({id: "asset-1"})
                .mockRejectedValueOnce(new Error("second asset failed")),
        });

        const job = await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "two images", negativePrompt: "", novelAi: {...baseNovelAiInput(), count: 2}, style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()});
        const client = await textToImageProjectClient(projectPath);

        await vi.waitFor(async () => {
            await expect(client.textToImageJob.findUnique({where: {id: job.id}})).resolves.toMatchObject({
                status: "failed",
                resultAssetIdsJson: "[\"asset-1\"]",
            });
        });
    });

    it("Provider 未收敛时 enqueue 与 retry 都在写入新 Job 前失败", async () => {
        const selectionError = Object.assign(new Error("需要显式选择 Provider"), {code: "TEXT_TO_IMAGE_PROVIDER_SELECTION_REQUIRED"});
        const request = vi.fn(async () => ({images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []}));
        const service = new TextToImageQueueService({
            assertProviderReady: async () => {
                throw selectionError;
            },
            deleteAsset: async () => undefined,
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => ({id: "must-not-exist"}),
        });
        const input = {projectPath, providerId: 9, kind: "manual" as const, prompt: "blocked", negativePrompt: "", novelAi: baseNovelAiInput(), style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()};

        await expect(service.enqueue(input)).rejects.toMatchObject({code: "TEXT_TO_IMAGE_PROVIDER_SELECTION_REQUIRED"});
        const client = await textToImageProjectClient(projectPath);
        const previousId = randomUUID();
        await client.textToImageJob.create({data: jobRecord(previousId, "failed")});
        await expect(service.retry(projectPath, previousId)).rejects.toMatchObject({code: "TEXT_TO_IMAGE_PROVIDER_SELECTION_REQUIRED"});

        await expect(client.textToImageJob.count()).resolves.toBe(1);
        expect(request).not.toHaveBeenCalled();
    });

    it("唯一 Provider 缺少 token 时 enqueue 与 retry 都在写入新 Job 前返回稳定错误", async () => {
        const notConfiguredError = Object.assign(new Error("NovelAI Provider 尚未配置完整 API token"), {code: "TEXT_TO_IMAGE_PROVIDER_NOT_CONFIGURED"});
        const service = new TextToImageQueueService({
            assertProviderReady: async () => {
                throw notConfiguredError;
            },
            deleteAsset: async () => undefined,
            requestImages: async () => ({images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []}),
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => ({id: "must-not-exist"}),
        });
        const input = {projectPath, providerId: 9, kind: "manual" as const, prompt: "blocked", negativePrompt: "", novelAi: baseNovelAiInput(), style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()};

        await expect(service.enqueue(input)).rejects.toMatchObject({code: "TEXT_TO_IMAGE_PROVIDER_NOT_CONFIGURED"});
        const client = await textToImageProjectClient(projectPath);
        const previousId = randomUUID();
        await client.textToImageJob.create({data: jobRecord(previousId, "failed")});
        await expect(service.retry(projectPath, previousId)).rejects.toMatchObject({code: "TEXT_TO_IMAGE_PROVIDER_NOT_CONFIGURED"});
        await expect(client.textToImageJob.count()).resolves.toBe(1);
    });

    it("仅对可重试的 429 响应在服务端重试，并保留同一任务记录", async () => {
        const throttled = Object.assign(new Error("NovelAI 请求失败：429"), {status: 429});
        const request = vi.fn()
            .mockRejectedValueOnce(throttled)
            .mockResolvedValueOnce({images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []});
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => {
                throw new Error("本测试不应保存图片");
            },
            wait: async () => undefined,
        });

        const job = await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "retry", negativePrompt: "", novelAi: baseNovelAiInput(), style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()});

        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
        expect(request.mock.calls[0]?.[0].novelAi.seed).toBe(request.mock.calls[1]?.[0].novelAi.seed);
        expect(request.mock.calls[0]?.[0].novelAi.seed).not.toBe(-1);
        await expect((await textToImageProjectClient(projectPath)).textToImageJob.findUnique({where: {id: job.id}})).resolves.toMatchObject({
            status: "succeeded",
            attemptCount: 2,
        });
    });

    it("执行边界始终强制同一 Provider 至少间隔 15 秒", async () => {
        const waits: number[] = [];
        const request = vi.fn(async () => ({images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []}));
        const service = new TextToImageQueueService({
            assertProviderReady: async (providerId) => providerSnapshot(providerId),
            deleteAsset: async () => undefined,
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", requestIntervalMs: 0}),
            saveAsset: async () => {
                throw new Error("本测试不应保存图片");
            },
            wait: async (milliseconds) => {
                waits.push(milliseconds);
            },
        });

        await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "first", negativePrompt: "", novelAi: baseNovelAiInput(), style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()});
        await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "second", negativePrompt: "", novelAi: baseNovelAiInput(), style: baseStyleInput(), recipeSnapshot: baseRecipeSnapshot()});

        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
        expect(waits).toHaveLength(1);
        expect(waits[0]).toBeGreaterThan(14_000);
    });

});

function baseNovelAiInput() {
    return {
        model: "nai-diffusion-4-5-full",
        sampler: "k_euler_ancestral",
        noiseSchedule: "karras",
        promptGuidance: 5,
        promptGuidanceRescale: 0,
        width: 832,
        height: 1216,
        steps: 28,
        seed: 123,
        count: 1,
        aiDefaultCharacterPosition: true,
        variety: false,
        smeaMode: "auto" as const,
        smeaDyn: false,
        decrisper: false,
    };
}

function providerSnapshot(providerId: number): TextToImageProviderSnapshotDto {
    return {
        ownerUserId: 1,
        providerId,
        credentialRevision: 1,
        kind: "novelai",
        name: "NovelAI",
        baseUrl: "https://image.novelai.net",
        settings: {allowPrivateNetwork: false, requestIntervalMs: 15_000},
        updatedAt: "2026-07-19T00:00:00.000Z",
    };
}

function baseStyleInput() {
    return getActiveTextToImageRecipeStyle(createDefaultTextToImageRecipeSource());
}

function baseRecipeSnapshot() {
    return createTextToImageRecipeSnapshot(createDefaultTextToImageRecipeSource());
}

function deferred<T>(): {promise: Promise<T>; resolve: (value: T) => void} {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((nextResolve) => {
        resolve = nextResolve;
    });
    return {promise, resolve};
}

function jobRecord(id: string, status: "queued" | "running") {
    return {
        id,
        providerId: 9,
        kind: "manual" as const,
        status,
        sourceInsertStatus: "not_applicable" as const,
        requestJson: JSON.stringify({
            prompt: "test",
            negativePrompt: "",
            novelAi: baseNovelAiInput(),
            style: baseStyleInput(),
            recipeSnapshot: baseRecipeSnapshot(),
        }),
        resultAssetIdsJson: "[]",
    };
}
