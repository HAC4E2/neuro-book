import {createError, defineEventHandler, getRouterParam} from "h3";
import {z} from "zod";
import {requireTextToImageUser} from "nbook/server/text-to-image/auth";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {resolveWorkspaceFileTarget} from "nbook/server/workspace-files/novel-workspace";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {
    findTextToImageAssetById,
    listTextToImageAssetsBySourceAnchorId,
} from "nbook/server/text-to-image/asset.service";
import {TextToImageQueueService} from "nbook/server/text-to-image/queue.service";
import {writeBodyImageAssetToChapter} from "nbook/server/text-to-image/body-image-writeback.service";

const RecoverPlaceholderBodySchema = z.object({
    projectRoot: z.string().trim().min(1),
    path: z.string().trim().min(1),
    assetId: z.string().trim().min(1),
});

/** 使用已有成功资产恢复正文引用，不重新调用 NovelAI。 */
export default defineEventHandler(async (event) => {
    await requireTextToImageUser(event);
    const body = await validateBody(event, RecoverPlaceholderBodySchema);
    const placeholderId = getRouterParam(event, "id") ?? "";
    if (placeholderId.trim() === "") {
        throw createError({statusCode: 400, message: "占位符 ID 不能为空"});
    }

    const projectPath = `workspace/${body.projectRoot}`;
    const asset = await findTextToImageAssetById(projectPath, body.assetId);
    if (!asset) {
        throw createError({statusCode: 404, message: `未找到图片资产：${body.assetId}`});
    }
    if (asset.sourceAnchorId !== placeholderId) {
        throw createError({statusCode: 409, message: "图片资产不属于当前正文占位符"});
    }

    const target = await resolveWorkspaceFileTarget(runtimePathsFromEnv(), {projectRoot: body.projectRoot});
    if (target.kind !== "project-workspace") {
        throw createError({statusCode: 400, message: "正文图片恢复必须使用 Project Workspace"});
    }
    const sourceAssets = await listTextToImageAssetsBySourceAnchorId(projectPath, placeholderId);
    const result = await writeBodyImageAssetToChapter({
        target,
        filePath: body.path,
        placeholderId,
        asset,
        existingAssetPaths: sourceAssets.map((item) => item.relativePath),
    });
    const queue = new TextToImageQueueService();
    if (result.status === "inserted" || result.status === "already_inserted") {
        await queue.markSourceInserted(projectPath, asset.jobId);
    } else {
        await queue.markSourceMissing(projectPath, asset.jobId);
    }
    return {
        status: result.status,
        asset: result.asset,
        content: result.content,
        regenerated: false,
    };
});
