import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {registerProjectResourceOwner, resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";
import {closeTextToImageProjectClient, textToImageProjectClient, textToImageProjectClientResourceOwner} from "nbook/server/text-to-image/project-client";

describe("TextToImageQueueService", () => {
    let assets: IsolatedWorkspaceAssets;
    let projectPath: string;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        registerProjectResourceOwner(textToImageProjectClientResourceOwner);
        assets = await createIsolatedWorkspaceAssets();
        projectPath = `workspace/text-to-image-queue-${randomUUID()}`;
        await writeProjectManifest(projectPath, {kind: "novel", title: "队列测试", summary: ""});
        await openProjectForTest(projectPath);
    });

    afterEach(async () => {
        await closeProjectForTest(projectPath).catch(() => undefined);
        await closeTextToImageProjectClient(projectPath).catch(() => undefined);
        resetProjectSessionsForTest();
        await assets.dispose();
    });

    it("在远端调用前持久化 queued 任务", async () => {
        const request = vi.fn(() => new Promise<never>(() => undefined));
        const service = new TextToImageQueueService({
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", model: "nai-diffusion-4-5-full", requestIntervalMs: 0}),
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
        });

        const stored = await (await textToImageProjectClient(projectPath)).textToImageJob.findUnique({where: {id: job.id}});
        expect(stored).toMatchObject({
            providerId: 9,
            status: "queued",
            requestJson: expect.not.stringMatching(/secret|data:image/),
        });
        expect(request).not.toHaveBeenCalled();
    });

    it("同一 Project 与 Provider 串行执行任务", async () => {
        const first = deferred<void>();
        const request = vi.fn(async () => {
            await first.promise;
            return {images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []};
        });
        const service = new TextToImageQueueService({
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", model: "nai-diffusion-4-5-full", requestIntervalMs: 0}),
            saveAsset: async () => {
                throw new Error("本测试不应保存图片");
            },
        });

        await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "first", negativePrompt: "", novelAi: baseNovelAiInput()});
        await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "second", negativePrompt: "", novelAi: baseNovelAiInput()});
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

        first.resolve();
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    });

    it("恢复时中断旧 running 任务，并重新调度 queued 任务", async () => {
        const request = vi.fn(async () => ({images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []}));
        const service = new TextToImageQueueService({
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", model: "nai-diffusion-4-5-full", requestIntervalMs: 0}),
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

    it("仅对可重试的 429 响应在服务端重试，并保留同一任务记录", async () => {
        const throttled = Object.assign(new Error("NovelAI 请求失败：429"), {status: 429});
        const request = vi.fn()
            .mockRejectedValueOnce(throttled)
            .mockResolvedValueOnce({images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []});
        const service = new TextToImageQueueService({
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", model: "nai-diffusion-4-5-full", requestIntervalMs: 0}),
            saveAsset: async () => {
                throw new Error("本测试不应保存图片");
            },
            wait: async () => undefined,
        });

        const job = await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "retry", negativePrompt: "", novelAi: baseNovelAiInput()});

        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
        await expect((await textToImageProjectClient(projectPath)).textToImageJob.findUnique({where: {id: job.id}})).resolves.toMatchObject({
            status: "succeeded",
            attemptCount: 2,
        });
    });

    it("按服务端 Provider 的请求间隔启动同一 lane 中的后续请求", async () => {
        const waits: number[] = [];
        const request = vi.fn(async () => ({images: [], request: {model: "nai-diffusion-4-5-full", seed: 1}, warnings: []}));
        const service = new TextToImageQueueService({
            requestImages: request,
            resolveProvider: async () => ({credential: "secret", model: "nai-diffusion-4-5-full", requestIntervalMs: 15_000}),
            saveAsset: async () => {
                throw new Error("本测试不应保存图片");
            },
            wait: async (milliseconds) => {
                waits.push(milliseconds);
            },
        });

        await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "first", negativePrompt: "", novelAi: baseNovelAiInput()});
        await service.enqueue({projectPath, providerId: 9, kind: "manual", prompt: "second", negativePrompt: "", novelAi: baseNovelAiInput()});

        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
        expect(waits).toHaveLength(1);
        expect(waits[0]).toBeGreaterThan(14_000);
    });

    it("正文任务成功后替换首张资产对应的占位符，替换失败不影响生成成功", async () => {
        const replaceBodyPrompt = vi.fn(async () => "inserted" as const);
        const service = new TextToImageQueueService({
            requestImages: async () => ({
                images: [{bytes: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png", width: 832, height: 1216, seed: 1}],
                request: {model: "nai-diffusion-4-5-full", seed: 1},
                warnings: [],
            }),
            resolveProvider: async () => ({credential: "secret", model: "nai-diffusion-4-5-full", requestIntervalMs: 0}),
            saveAsset: async () => ({id: "asset-1", asset: assetDto()}),
            replaceBodyPrompt,
        });

        const job = await service.enqueue({
            projectPath,
            providerId: 9,
            kind: "body",
            prompt: "scene",
            negativePrompt: "",
            novelAi: baseNovelAiInput(),
            sourcePath: "manuscript/chapter-1.md",
            sourceAnchorId: "tti-1",
        });

        await vi.waitFor(() => expect(replaceBodyPrompt).toHaveBeenCalledTimes(1));
        await expect((await textToImageProjectClient(projectPath)).textToImageJob.findUnique({where: {id: job.id}})).resolves.toMatchObject({
            status: "succeeded",
            sourceInsertStatus: "inserted",
            resultAssetIdsJson: "[\"asset-1\"]",
        });
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
        seed: 1,
        count: 1,
    };
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
        requestJson: JSON.stringify({prompt: "test", negativePrompt: "", novelAi: baseNovelAiInput()}),
        resultAssetIdsJson: "[]",
    };
}

function assetDto() {
    return {
        id: "asset-1",
        jobId: "job-1",
        relativePath: "assets/text-to-image/2026/07/asset-1.png",
        fileName: "asset-1.png",
        mimeType: "image/png",
        byteLength: 4,
        width: 832,
        height: 1216,
        model: "nai-diffusion-4-5-full",
        seed: 1,
        prompt: "scene",
        negativePrompt: "",
        sourceKind: "body",
        sourcePath: "manuscript/chapter-1.md",
        sourceAnchorId: "tti-1",
        createdAt: "2026-07-11T00:00:00.000Z",
    };
}
