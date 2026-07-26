/**
 * 手动把本地 TTP tagData 导入并激活 NeuroBook Tag index。
 * 生产环境由 server/plugins/text-to-image-tag-index-boot.ts 在启动时自动完成同样的事；
 * 本脚本用于开发环境提前构建索引或排查导入问题。
 * 运行方式: bun run scripts/build/import-ttp-tag-index.ts
 */
import {TagIndexRuntime, TAG_INDEX_TERMS_CONTENT_HASH} from "nbook/server/text-to-image/tag-index/tag-index-runtime";
import {TAG_INDEX_TERMS_CONFIRMATION_VERSION} from "nbook/shared/text-to-image-tag-index";
import {resolveTtpTagDataDir} from "nbook/server/text-to-image/tag-index/ttp-source-client";

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 5 * 60 * 1000;

async function main() {
    const dir = resolveTtpTagDataDir();
    if (!dir) {
        console.error("[ttp-import] 未找到 TTP tagData 目录（检查打包资产或 TTP_TAGDATA_DIR）");
        process.exit(1);
    }
    console.log("[ttp-import] tagData 目录:", dir);

    const runtime = new TagIndexRuntime();
    const status = await runtime.status();
    if (status.active) {
        console.log("[ttp-import] Tag index 已激活，跳过导入。");
        return;
    }

    // 取消上一次卡住的非终态 operation，避免 lease 阻塞新导入
    if (status.operation && !["active", "failed", "canceled"].includes(status.operation.state)) {
        console.log(`[ttp-import] 取消卡住的 operation: ${status.operation.operationId} (${status.operation.state})`);
        try {
            await runtime.cancel(status.operation.operationId);
        } catch (error) {
            console.warn("[ttp-import] 取消失败（可能已终态）:", error instanceof Error ? error.message : error);
        }
    }

    console.log("[ttp-import] 开始导入本地 tagData ...");
    const operation = await runtime.start({
        confirmed: true,
        termsConfirmationVersion: TAG_INDEX_TERMS_CONFIRMATION_VERSION,
        termsContentHash: TAG_INDEX_TERMS_CONTENT_HASH,
    });
    console.log(`[ttp-import] operation: ${operation.operationId}`);

    const startTime = Date.now();
    while (Date.now() - startTime < TIMEOUT_MS) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        const current = await runtime.status();

        if (current.active) {
            console.log(`[ttp-import] Tag index 已激活: ${current.active.indexVersion}（主集合 ${current.active.counts.mainTags} 条）`);
            return;
        }
        if (current.operation) {
            const op = current.operation;
            const progress = current.progress;
            console.log(`[ttp-import] 状态: ${op.state}, pages: ${progress?.pageCount ?? 0}, records: ${progress?.recordCount ?? 0}`);
            if (op.state === "failed") {
                console.error("[ttp-import] 导入失败:", op.error?.message ?? "未知错误");
                process.exit(1);
            }
            if (op.state === "canceled") {
                console.error("[ttp-import] 导入被取消。");
                process.exit(1);
            }
        }
    }

    console.error("[ttp-import] 等待导入完成超时。");
    process.exit(1);
}

main().catch(err => {
    console.error("[ttp-import] 致命错误:", err);
    process.exit(1);
});
