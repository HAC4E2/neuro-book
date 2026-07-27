import {appLogger} from "nbook/server/app-logs/logger";
import {createServerTiming} from "nbook/server/utils/server-timing";
import {listNovels, type NovelListDiagnostics} from "nbook/server/utils/novel-chapter";

const SLOW_PROJECT_LIST_MS = 500;

/**
 * 查询 Project Workspace 列表。
 *
 * 列表只读 manifest，不接受裁剪参数：调用方需要过滤时在自己那侧筛选。
 */
export default defineEventHandler(async (event) => {
    const startedAt = performance.now();
    const timingSink = createServerTiming(event);
    const diagnostics: NovelListDiagnostics = {};
    const novels = await listNovels({timingSink, diagnostics});
    const durationMs = performance.now() - startedAt;
    if (durationMs > SLOW_PROJECT_LIST_MS) {
        void appLogger.warn("projects.list.slow", {
            durationMs,
            projectCount: diagnostics.projectCount ?? novels.length,
            cache: {projectList: diagnostics.projectListCache},
        }, "Project 列表请求过慢");
    }
    return novels;
});
