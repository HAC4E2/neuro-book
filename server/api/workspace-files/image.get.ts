import {createReadStream} from "node:fs";
import {createError, sendStream, setResponseHeader} from "h3";
import {resolveWorkspaceFileTarget} from "nbook/server/workspace-files/novel-workspace";
import {assertProjectOpenForTarget} from "nbook/server/workspace-files/project-open-guard";
import {resolveWorkspaceImageFile} from "nbook/server/workspace-files/workspace-files";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

/**
 * 读取工作区内图片文件字节，供正文 Markdown 图片预览使用。
 * 只接受项目相对路径；projectPath 解析、Project-open guard 与路径包含性校验
 * 与 read.get.ts 完全同构，取代旧的无守卫绝对路径路由 /api/text-to-image/image。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const rawPath = typeof query.path === "string" ? query.path.trim() : "";
    if (!rawPath) {
        throw createError({statusCode: 400, message: "图片路径不能为空"});
    }
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : undefined;
    const workspaceKind = query.workspaceKind === "user-assets" ? query.workspaceKind : undefined;
    const target = await resolveWorkspaceFileTarget(runtimePathsFromEnv(), {projectPath, workspaceKind});
    assertProjectOpenForTarget(target);

    let image: Awaited<ReturnType<typeof resolveWorkspaceImageFile>>;
    try {
        image = await resolveWorkspaceImageFile(target.root, rawPath);
    } catch {
        // 统一固定文案：底层错误消息含服务器绝对路径，不得透给客户端。
        throw createError({statusCode: 404, message: "图片不存在或不可读取"});
    }

    setResponseHeader(event, "Content-Type", image.mimeType);
    setResponseHeader(event, "Content-Length", image.byteLength);
    // 生成图片以 uuid 命名、内容不可变，可长缓存；用户自管图片 URL 不含内容指纹，必须每次回源校验。
    setResponseHeader(
        event,
        "Cache-Control",
        rawPath.replaceAll("\\", "/").startsWith("assets/text-to-image/") ? "private, max-age=3600" : "private, no-cache",
    );
    return sendStream(event, createReadStream(image.absolutePath));
});
