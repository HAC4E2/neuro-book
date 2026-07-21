import {toValue, watch, type MaybeRefOrGetter} from "vue";
import type {
    TextToImagePromptController,
    TextToImagePromptGeneratePayload,
    TextToImagePromptPresentation,
} from "nbook/app/components/markdown-studio/tiptap/TextToImagePrompt";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorCode, resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    buildIllustrationGenerateBody,
    formatIllustrationPreviewSummary,
} from "nbook/app/utils/illustration-execution-ui";
import {
    IllustrationExecutionRegistrationReceiptSchema,
} from "nbook/shared/text-to-image-execution";
import {
    IllustrationExecutionPreviewSchema,
    IllustrationPlaceholderStatusSchema,
    type IllustrationExecutionPreview,
    type IllustrationPlaceholderStatus,
} from "nbook/shared/text-to-image-execution-ui";

type PreviewCacheEntry = {
    stateHash: string;
    preview: IllustrationExecutionPreview;
};

type ResolvedPrompt = {
    presentation: TextToImagePromptPresentation;
    /** status 非 ready 或 preview 编译失败时为 null。 */
    preview: IllustrationExecutionPreview | null;
};

const PREVIEW_EXPIRY_SAFETY_MS = 5_000;

/**
 * 正文 V2 placeholder 的宿主控制器。
 * Map 只缓存服务端签发的短期 Preview DTO；Project Job/Manifest 状态每次从 `/status` 读取。
 */
export function useIllustrationExecutionController(projectPath: MaybeRefOrGetter<string | null>): TextToImagePromptController {
    const notification = useNotification();
    const dialog = useDialog();
    const previewCache = new Map<string, PreviewCacheEntry>();

    watch(() => toValue(projectPath), () => previewCache.clear());

    /** 可视区加载：先读服务端状态，只有 ready 才无副作用编译 Preview。 */
    const resolve = async (payload: TextToImagePromptGeneratePayload): Promise<TextToImagePromptPresentation> => {
        return (await resolvePrompt(payload)).presentation;
    };

    /** 单击只提交已经展示且仍有效的 Preview；漂移时展示新摘要并再次确认。 */
    const generate = async (payload: TextToImagePromptGeneratePayload): Promise<TextToImagePromptPresentation> => {
        const project = toValue(projectPath);
        if (!project) return unavailablePresentation("当前没有打开 Project");
        const resolved = await resolvePrompt(payload);
        if (resolved.presentation.status !== "ready" || !resolved.preview) return resolved.presentation;
        try {
            return await authorize(project, payload.placeholderId, resolved.preview);
        } catch (error) {
            const code = resolveApiErrorCode(error);
            if (code === "ILLUSTRATION_PREVIEW_CONFIRMATION_REQUIRED" || code === "ILLUSTRATION_PREVIEW_TOKEN_EXPIRED") {
                const refreshed = await fetchPreview(project, payload.placeholderId);
                const confirmed = await dialog.confirm(
                    `图片请求摘要已变化，请确认新的请求：\n${formatIllustrationPreviewSummary(refreshed)}`,
                    "重新确认图片生成",
                );
                if (!confirmed) {
                    return {status: "ready", summary: formatIllustrationPreviewSummary(refreshed), errorMessage: ""};
                }
                try {
                    return await authorize(project, payload.placeholderId, refreshed);
                } catch (retryError) {
                    return reportAuthorizationError(retryError, refreshed);
                }
            }
            return reportAuthorizationError(error, resolved.preview);
        }
    };

    /** statusHash/TTL/source identity 共同约束 Preview cache。 */
    const resolvePrompt = async (payload: TextToImagePromptGeneratePayload): Promise<ResolvedPrompt> => {
        const project = toValue(projectPath);
        if (!project) return {presentation: unavailablePresentation("当前没有打开 Project"), preview: null};
        const status = IllustrationPlaceholderStatusSchema.parse(await $fetch<unknown>(
            `/api/text-to-image/prompt-placeholders/${encodeURIComponent(payload.placeholderId)}/status`,
            {query: {projectPath: project}},
        ));
        const key = cacheKey(project, payload.placeholderId);
        const cached = previewCache.get(key);
        if (cached && cached.stateHash !== status.stateHash) previewCache.delete(key);
        if (status.status !== "ready" || status.sourceIdentityHash === null) {
            return {presentation: presentationFromStatus(status), preview: null};
        }
        const current = previewCache.get(key);
        if (current
            && current.preview.expiresAt > Date.now() + PREVIEW_EXPIRY_SAFETY_MS
            && current.preview.requests[0]?.sourceIdentityHash === status.sourceIdentityHash) {
            return {
                presentation: {status: "ready", summary: formatIllustrationPreviewSummary(current.preview), errorMessage: ""},
                preview: current.preview,
            };
        }
        try {
            const preview = await fetchPreview(project, payload.placeholderId);
            previewCache.set(key, {stateHash: status.stateHash, preview});
            return {
                presentation: {status: "ready", summary: formatIllustrationPreviewSummary(preview), errorMessage: ""},
                preview,
            };
        } catch (error) {
            return {
                presentation: {status: "stale", summary: "请求摘要需要刷新", errorMessage: resolveApiErrorMessage(error, "准备图片请求失败")},
                preview: null,
            };
        }
    };

    /** 每次刷新产生新的签名 nonce；只在 cache 失效或明确 confirmation required 时调用。 */
    const fetchPreview = async (project: string, placeholderId: string): Promise<IllustrationExecutionPreview> => {
        const preview = IllustrationExecutionPreviewSchema.parse(await $fetch<unknown>(
            `/api/text-to-image/prompt-placeholders/${encodeURIComponent(placeholderId)}/execution-preview`,
            {query: {projectPath: project}},
        ));
        const status = IllustrationPlaceholderStatusSchema.parse(await $fetch<unknown>(
            `/api/text-to-image/prompt-placeholders/${encodeURIComponent(placeholderId)}/status`,
            {query: {projectPath: project}},
        ));
        previewCache.set(cacheKey(project, placeholderId), {stateHash: status.stateHash, preview});
        return preview;
    };

    /** POST body 由严格 builder 产生，无法携带 Prompt、Provider、Recipe 或 seed override。 */
    const authorize = async (
        project: string,
        placeholderId: string,
        preview: IllustrationExecutionPreview,
    ): Promise<TextToImagePromptPresentation> => {
        IllustrationExecutionRegistrationReceiptSchema.parse(await $fetch<unknown>(
            `/api/text-to-image/prompt-placeholders/${encodeURIComponent(placeholderId)}/generate`,
            {method: "POST", body: buildIllustrationGenerateBody(project, preview)},
        ));
        previewCache.delete(cacheKey(project, placeholderId));
        notification.success("图片任务已排队", {title: "生成图片"});
        return {status: "queued", summary: "任务已注册，等待 NovelAI Provider lane", errorMessage: ""};
    };

    /** 授权失败必须跨入口可见，并保留当前 Preview 供用户重试。 */
    const reportAuthorizationError = (error: unknown, preview: IllustrationExecutionPreview): TextToImagePromptPresentation => {
        const message = resolveApiErrorMessage(error, "注册图片任务失败");
        notification.error(message, {title: "生成图片失败"});
        return {status: "ready", summary: formatIllustrationPreviewSummary(preview), errorMessage: message};
    };

    return {resolve, generate};
}

/** 从严格服务端状态生成 NodeView 投影。 */
function presentationFromStatus(status: IllustrationPlaceholderStatus): TextToImagePromptPresentation {
    const summary = status.job
        ? `Job ${status.job.jobId} · ${status.job.status}${status.job.sourceInsertStatus === "missing" ? " · 未插入正文" : ""}`
        : status.status === "stale" ? "正文或 Storyboard 已漂移，请重新规划或修正配置" : "正在读取服务端状态";
    return {status: status.status, summary, errorMessage: status.errorMessage ?? ""};
}

/** 无 Project/宿主时返回明确失效态。 */
function unavailablePresentation(message: string): TextToImagePromptPresentation {
    return {status: "stale", summary: message, errorMessage: ""};
}

/** cache key 显式包含 Project，切换 Project 不会复用同名 placeholder。 */
function cacheKey(projectPath: string, placeholderId: string): string {
    return `${projectPath}\u0000${placeholderId}`;
}
