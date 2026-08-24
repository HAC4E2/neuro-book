import {resolveWorkspaceFileTarget} from "nbook/server/workspace-files/novel-workspace";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {listTextToImageAssetsBySourceAnchorId, saveTextToImageAsset} from "nbook/server/text-to-image/asset.service";
import {readTextToImageReferenceImageBytes} from "nbook/server/text-to-image/reference-image.service";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {processTextToImageJobs, type TextToImageQueueDependencies} from "nbook/server/text-to-image/queue.processor";
import {TextToImageQueueService, type TextToImageJobDto} from "nbook/server/text-to-image/queue.service";
import {requestNovelAiImages} from "nbook/server/text-to-image/novelai-image-generation";
import {writeBodyImageAssetToChapter} from "nbook/server/text-to-image/body-image-writeback.service";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";

type QueueWorkerState = {
    requested: boolean;
    promise: Promise<number>;
};

const workers = new Map<string, QueueWorkerState>();

/**
 * 构造所有入口共用的队列依赖。正文写回在消费者内完成，入队 API 不再承担长请求。
 */
export function createTextToImageQueueDependencies(): TextToImageQueueDependencies {
    const queue = new TextToImageQueueService();
    const providerService = new TextToImageProviderService();
    return {
        listQueued: (path) => queue.list(path, "queued"),
        markRunning: (path, id) => queue.markRunning(path, id),
        markSucceeded: (path, id) => queue.markSucceeded(path, id),
        markFailed: (path, id, message) => queue.markFailed(path, id, message),
        markSourceInserted: (path, id) => queue.markSourceInserted(path, id),
        markSourceMissing: (path, id) => queue.markSourceMissing(path, id),
        resolveRuntime: (ownerUserId, providerId) => providerService.resolveRuntimeProvider(ownerUserId, providerId),
        generate: (input) => requestNovelAiImages(input, {
            readReference: (relativePath) => readTextToImageReferenceImageBytes(relativePath),
        }),
        saveAsset: saveTextToImageAsset,
        writeBodyAsset: (path, job, asset) => writeBodyAsset(path, job, asset),
    };
}

/**
 * 唤醒指定 Project 的唯一消费者。并发唤醒只复用同一个 Promise，避免两个请求同时领取队列。
 */
export function kickTextToImageQueue(projectPath: string): Promise<number> {
    const existing = workers.get(projectPath);
    if (existing) {
        existing.requested = true;
        return existing.promise;
    }

    const state: QueueWorkerState = {
        requested: false,
        promise: Promise.resolve(0),
    };
    const dependencies = createTextToImageQueueDependencies();
    state.promise = (async () => {
        let processed = 0;
        try {
            while (true) {
                state.requested = false;
                processed += await processTextToImageJobs(projectPath, dependencies);
                const queued = await dependencies.listQueued(projectPath);
                if (!state.requested && queued.length === 0) break;
            }
            return processed;
        } catch (error) {
            // 单个 Job 的供应商/写回错误由 processor 标记 failed；这里只处理
            // 列表、数据库或依赖初始化等消费者级故障，避免前端永远轮询 queued。
            const message = error instanceof Error ? error.message : "队列消费者异常终止";
            try {
                const queued = await dependencies.listQueued(projectPath);
                await Promise.allSettled(queued.map((job) => dependencies.markFailed(projectPath, job.id, message)));
            } catch {
                // 数据库本身不可用时无法推进状态，保留原始错误供手动重试恢复。
            }
            throw error;
        }
    })().finally(() => {
        if (workers.get(projectPath) === state) workers.delete(projectPath);
    });
    workers.set(projectPath, state);
    return state.promise;
}

async function writeBodyAsset(
    projectPath: string,
    job: TextToImageJobDto,
    asset: TextToImageAssetDto,
): Promise<"inserted" | "already_inserted" | "missing"> {
    if (!job.sourcePath || !job.sourceAnchorId) {
        return "missing";
    }
    const projectRoot = projectPath.startsWith("workspace/")
        ? projectPath.slice("workspace/".length)
        : projectPath;
    const target = await resolveWorkspaceFileTarget(runtimePathsFromEnv(), {projectRoot});
    if (target.kind !== "project-workspace") {
        throw new Error("正文图片写回必须使用 Project Workspace");
    }
    const existingAssets = await listTextToImageAssetsBySourceAnchorId(projectPath, job.sourceAnchorId);
    const result = await writeBodyImageAssetToChapter({
        target,
        filePath: job.sourcePath,
        placeholderId: job.sourceAnchorId,
        asset,
        existingAssetPaths: existingAssets.map((item) => item.relativePath),
    });
    return result.status;
}
