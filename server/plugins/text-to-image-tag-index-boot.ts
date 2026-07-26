import {defineNitroPlugin} from "nitropack/runtime";
import {appLogger} from "nbook/server/app-logs/logger";
import {
    getTagIndexRuntime,
    TAG_INDEX_TERMS_CONTENT_HASH,
} from "nbook/server/text-to-image/tag-index/tag-index-runtime";
import {TAG_INDEX_TERMS_CONFIRMATION_VERSION} from "nbook/shared/text-to-image-tag-index";

/**
 * 服务启动时自动检查 tag index 状态，未就绪则在后台自动开始同步。
 * 不阻塞服务就绪——同步在后台异步进行，前端可通过 /api/text-to-image/tag-index 轮询进度。
 */
export default defineNitroPlugin((nitroApp) => {
    void (async () => {
        try {
            const runtime = getTagIndexRuntime();
            const status = await runtime.status();
            if (status.active) {
                await appLogger.info("tag-index.boot.already-ready", undefined, "Tag index 已就绪，无需自动同步");
                return;
            }
            // 检查是否已有进行中的 operation（例如用户已手动触发）
            if (status.operation && !["active", "failed", "canceled"].includes(status.operation.state)) {
                await appLogger.info("tag-index.boot.stale-operation", undefined, `Tag index 存在卡死操作 ${status.operation.operationId} (${status.operation.state})，取消后重新同步`);
                await runtime.cancel(status.operation.operationId);
            }
            await appLogger.info("tag-index.boot.starting", undefined, "Tag index 未就绪，启动后台自动同步");
            await runtime.start({
                confirmed: true,
                termsConfirmationVersion: TAG_INDEX_TERMS_CONFIRMATION_VERSION,
                termsContentHash: TAG_INDEX_TERMS_CONTENT_HASH,
            });
            await appLogger.info("tag-index.boot.sync-started", undefined, "Tag index 后台同步已启动");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await appLogger.error("tag-index.boot.failed", undefined, `Tag index 自动同步启动失败: ${message}`);
        }
    })();
});
