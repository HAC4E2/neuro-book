import {createError, defineEventHandler, getRouterParam, setResponseStatus} from "h3";
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
} from "nbook/server/text-to-image/chapter.service";
import {
    BodyPromptCompileError,
    compileBodyPrompt,
} from "nbook/server/text-to-image/body-prompt-compiler";
import {CharacterVisualFileSchema} from "nbook/server/text-to-image/character-visual.codec";
import {TextToImageProviderService} from "nbook/server/text-to-image/provider.service";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {kickTextToImageQueue} from "nbook/server/text-to-image/queue-runtime";
import {listTextToImageAssetsBySourceAnchorId} from "nbook/server/text-to-image/asset.service";

const GeneratePlaceholderBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    path: z.string().trim().min(1),
    providerId: z.number().int().positive(),
});

/**
 * 从 TipTap 占位符卡片一键生成：展开 `${...}$` 角色代码并持久化 Job。
 * 队列消费者异步完成 NovelAI 请求、资产保存和正文写回。
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
    const content = await readChapterMarkdown(absoluteFsPath(projectRoot), body.path);
    const queue = new TextToImageQueueService();
    // 先处理同一占位符的活动 Job。重复点击必须是幂等的，不能因为当前
    // Provider/visual 临时不可用而把已经排队的任务伪装成新的失败请求。
    const activeJob = (await queue.list(projectPath)).find((item) =>
        item.kind === "body"
        && item.sourcePath === body.path
        && item.sourceAnchorId === placeholderId
        && (item.status === "queued" || item.status === "running"),
    );
    if (activeJob) {
        setResponseStatus(event, 202);
        void kickTextToImageQueue(projectPath).catch(() => undefined);
        return {
            status: "queued" as const,
            jobId: activeJob.id,
            placeholderId,
            queuePosition: null,
        };
    }
    const matched = findTextToImagePromptMarkdown(content, placeholderId);
    if (!matched) {
        const existingAssets = await listTextToImageAssetsBySourceAnchorId(projectPath, placeholderId);
        const existingAsset = existingAssets.find((asset) => content.includes(asset.relativePath));
        if (existingAsset) {
            const queue = new TextToImageQueueService();
            await queue.markSourceInserted(projectPath, existingAsset.jobId);
            return {
                status: "already_inserted" as const,
                jobId: existingAsset.jobId,
                placeholderId,
                queuePosition: null,
                asset: existingAsset,
                content,
            };
        }
        throw createError({statusCode: 404, message: `未找到占位符：${placeholderId}`});
    }

    const temporaryCharacters = (matched.payload.temporaryCharacters ?? [])
        .map((item) => CharacterVisualFileSchema.parse(item));
    const compiled = await compileBodyPromptOrThrow(projectRoot, matched.payload.prompt, temporaryCharacters);
    const characterPrompts = await Promise.all((matched.payload.characterPrompts ?? []).map(async (characterPrompt) => {
        const compiledPrompt = await compileBodyPromptOrThrow(projectRoot, characterPrompt.prompt, temporaryCharacters);
        const compiledNegative = await compileBodyPromptOrThrow(projectRoot, characterPrompt.negativePrompt, temporaryCharacters);
        return {
            prompt: compiledPrompt.prompt,
            negativePrompt: [compiledNegative.prompt, compiledNegative.negativePrompt]
                .filter((part) => part.trim() !== "")
                .join(", "),
            ...(characterPrompt.centerX === undefined ? {} : {centerX: characterPrompt.centerX}),
            ...(characterPrompt.centerY === undefined ? {} : {centerY: characterPrompt.centerY}),
        };
    }));
    const providerService = new TextToImageProviderService();
    const provider = (await providerService.list(user.id)).find(
        (item) => item.id === body.providerId && item.kind === "novelai",
    );
    if (!provider) {
        throw createError({statusCode: 400, message: "NovelAI Provider 不存在"});
    }

    const sizeOverrides = parseTextToImageSize(matched.payload.size);
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
            characterPrompts,
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
    setResponseStatus(event, 202);
    void kickTextToImageQueue(projectPath).catch(() => undefined);
    const queuedJobs = (await queue.list(projectPath, "queued")).sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
    const queuePosition = queuedJobs.findIndex((item) => item.id === job.id);
    return {
        status: "queued" as const,
        jobId: job.id,
        placeholderId,
        queuePosition: queuePosition < 0 ? null : queuePosition + 1,
    };
});

async function compileBodyPromptOrThrow(
    projectRoot: string,
    prompt: string,
    temporaryCharacters: ReturnType<typeof CharacterVisualFileSchema.parse>[],
) {
    try {
        return await compileBodyPrompt(projectRoot, prompt, {temporaryCharacters});
    } catch (error) {
        if (!(error instanceof BodyPromptCompileError)) throw error;
        throw createError({
            statusCode: error.statusCode,
            message: error.message,
            data: {code: error.code},
        });
    }
}

export function parseTextToImageSize(size: string): {width?: number; height?: number} {
    const matches = [...size.matchAll(/(\d{2,5})\s*(?:x|×|by)\s*(\d{2,5})/giu)];
    for (const matched of matches.reverse()) {
        const width = Number(matched[1]);
        const height = Number(matched[2]);
        if (Number.isInteger(width) && Number.isInteger(height)
            && width >= 64 && width <= 4096
            && height >= 64 && height <= 4096) {
            return {width, height};
        }
    }
    return {};
}
