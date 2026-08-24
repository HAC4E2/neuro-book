import {createError, defineEventHandler, getRouterParam, getQuery} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {findTextToImageAssetByJobId} from "nbook/server/text-to-image/asset.service";
import {resolveWorkspaceFileTarget} from "nbook/server/workspace-files/novel-workspace";
import {readWorkspaceTextFile, statWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

const JobStatusQuerySchema = z.object({
    projectRoot: z.string().trim().min(1),
    path: z.string().trim().min(1).optional(),
});

/** 查询队列 Job，并在正文 Job 终态时返回服务端写回后的章节版本。 */
export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const jobId = getRouterParam(event, "id") ?? "";
    if (jobId.trim() === "") {
        throw createError({statusCode: 400, message: "Job ID 不能为空"});
    }
    const query = JobStatusQuerySchema.parse(getQuery(event));
    const projectPath = `workspace/${query.projectRoot}`;
    const queue = new TextToImageQueueService();
    const job = (await queue.list(projectPath)).find((item) => item.id === jobId);
    if (!job) {
        throw createError({statusCode: 404, message: `未找到生图任务：${jobId}`});
    }

    const asset = job.status === "succeeded" || job.status === "failed"
        ? await findTextToImageAssetByJobId(projectPath, job.id)
        : null;
    const chapterRevision = job.kind === "body" && job.status === "succeeded" && query.path
        ? await readChapterRevision(query.projectRoot, query.path)
        : null;
    return {job, asset, chapterRevision};
});

async function readChapterRevision(projectRoot: string, path: string) {
    const target = await resolveWorkspaceFileTarget(runtimePathsFromEnv(), {projectRoot});
    if (target.kind !== "project-workspace") {
        return null;
    }
    const [node, content] = await Promise.all([
        statWorkspacePath(target.root, path),
        readWorkspaceTextFile(target.root, path),
    ]);
    return {path, node, content};
}
