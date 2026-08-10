import {createError, defineEventHandler, getRouterParam} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {resolveTextToImageProjectRoot} from "nbook/server/text-to-image/project-client";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    findTextToImagePromptMarkdown,
} from "nbook/shared/text-to-image-markdown";
import {
    readChapterMarkdown,
    replacePromptPlaceholderWithAsset,
} from "nbook/server/text-to-image/chapter.service";
import {compileBodyPrompt} from "nbook/server/text-to-image/body-prompt-compiler";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {processTextToImageJobs} from "nbook/server/text-to-image/queue.processor";
import {requestNovelAiImages} from "nbook/server/text-to-image/novelai-image-generation";
import {
    findLatestTextToImageAssetBySourceAnchorId,
    saveTextToImageAsset,
} from "nbook/server/text-to-image/asset.service";
import {readTextToImageReferenceImageBytes} from "nbook/server/text-to-image/reference-image.service";

const GeneratePlaceholderBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    path: z.string().trim().min(1),
    providerId: z.number().int().positive(),
    /** 编辑器当前正文；传入时优先用它定位占位符，避免覆盖未保存修改。 */
    content: z.string().optional(),
});

/**
 * 从 TipTap 占位符卡片一键生成：展开 `${...}$` 角色代码 → 入队 → 消费队列 →
 * 找到最新资产并把正文里的占位符替换为 Markdown 图片引用。
 */
export default defineEventHandler(async (event) => {
    const user = await requireTextToImageUser(event);
    const body = await validateBody(event, GeneratePlaceholderBodySchema);
    const placeholderId = getRouterParam(event, "id") ?? "";
    if (placeholderId.trim() === "") {
        throw createError({statusCode: 400, message: "占位符 ID 不能为空"});
    }

    const projectPath = `workspace/${body.projectRoot}`;
    const projectRoot = resolveTextToImageProjectRoot(projectPath);
    const content = body.content ?? await readChapterMarkdown(absoluteFsPath(projectRoot), body.path);
    const matched = findTextToImagePromptMarkdown(content, placeholderId);
    if (!matched) {
        throw createError({statusCode: 404, message: `未找到占位符：${placeholderId}`});
    }

    const compiled = await compileBodyPrompt(projectRoot, matched.payload.prompt);
    const providerService = new TextToImageProviderService();
    const provider = (await providerService.list(user.id)).find(
        (item) => item.id === body.providerId && item.kind === "novelai",
    );
    if (!provider) {
        throw createError({statusCode: 400, message: "NovelAI Provider 不存在"});
    }

    const sizeOverrides = parseTextToImageSize(matched.payload.size);
    const queue = new TextToImageQueueService();
    const job = await queue.enqueue({
        projectPath,
        providerId: provider.id,
        providerOwnerUserId: user.id,
        providerCredentialRevision: provider.credentialRevision,
        kind: "body",
        sourcePath: body.path,
        sourceAnchorId: placeholderId,
        requestJson: JSON.stringify({
            prompt: compiled.prompt,
            negativePrompt: matched.payload.negativePrompt || compiled.negativePrompt,
            novelAi: {
                ...provider.settings,
                ...sizeOverrides,
            },
        }),
        providerSnapshotJson: JSON.stringify({
            providerId: provider.id,
            credentialRevision: provider.credentialRevision,
        }),
    });

    await processTextToImageJobs(projectPath, {
        listQueued: (projectPath) => queue.list(projectPath, "queued"),
        markRunning: (projectPath, id) => queue.markRunning(projectPath, id),
        markSucceeded: (projectPath, id) => queue.markSucceeded(projectPath, id),
        markFailed: (projectPath, id, message) => queue.markFailed(projectPath, id, message),
        resolveRuntime: (ownerUserId, providerId) => providerService.resolveRuntimeProvider(ownerUserId, providerId),
        generate: (input) => requestNovelAiImages(input, {
            readReference: (relativePath) => readTextToImageReferenceImageBytes(relativePath),
        }),
        saveAsset: saveTextToImageAsset,
    });

    const completedJob = (await queue.list(projectPath)).find((item) => item.id === job.id);
    if (completedJob?.status === "failed") {
        const statusCode = completedJob.errorMessage?.includes("HTTP 429") ? 429 : 502;
        throw createError({
            statusCode,
            message: completedJob.errorMessage ?? "NovelAI 生图失败",
        });
    }
    const asset = await findLatestTextToImageAssetBySourceAnchorId(projectPath, placeholderId);
    if (!asset) {
        throw createError({statusCode: 500, message: "队列处理完成但未找到生成资产"});
    }
    return {
        jobId: job.id,
        asset,
        content: replacePromptPlaceholderWithAsset(content, placeholderId, asset),
    };
});

function parseTextToImageSize(size: string): {width?: number; height?: number} {
    const matched = /^\s*(\d+)\s*x\s*(\d+)\s*$/iu.exec(size.trim());
    if (!matched) return {};
    const width = Number(matched[1]);
    const height = Number(matched[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return {};
    return {width, height};
}
