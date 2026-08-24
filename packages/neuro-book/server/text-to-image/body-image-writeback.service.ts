import type {WorkspaceFileNode} from "nbook/server/workspace-files/workspace-files";
import {
    readWorkspaceTextFile,
    statWorkspacePath,
} from "nbook/server/workspace-files/workspace-files";
import {withProjectTargetMutation} from "nbook/server/workspace-files/project-open-guard";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import {USER_LOCAL_ACTOR, writeWorkspaceTextFileTracked} from "nbook/server/workspace-history/tracked-workspace-files";
import {
    findTextToImagePromptMarkdown,
    renderTextToImageAssetMarkdown,
} from "nbook/shared/text-to-image-markdown";
import type {TextToImageAssetDto} from "nbook/shared/dto/text-to-image.dto";

export type BodyImageWritebackStatus = "inserted" | "already_inserted" | "missing";

export type BodyImageWritebackResult = {
    status: BodyImageWritebackStatus;
    content: string;
    asset: TextToImageAssetDto;
};

export type BodyImageWritebackInput = {
    target: Extract<WorkspaceFileTarget, {kind: "project-workspace"}>;
    filePath: string;
    placeholderId: string;
    asset: TextToImageAssetDto;
    /** 同一 sourceAnchorId 的历史资产路径，用于识别旧请求已经完成的插入。 */
    existingAssetPaths?: readonly string[];
    maxRetries?: number;
};

/**
 * 在最新章节正文中写回一张正文图片。
 *
 * 这个服务只按占位符 ID 做局部替换，不接受浏览器整篇旧正文；写入经过 Project
 * mutation/history 边界，并在文件版本变化时重新读取后重试，避免并发请求互相覆盖。
 */
export async function writeBodyImageAssetToChapter(
    input: BodyImageWritebackInput,
): Promise<BodyImageWritebackResult> {
    const maxRetries = Math.max(1, Math.min(5, input.maxRetries ?? 3));
    return await withProjectTargetMutation(input.target, async (handles) => {
        if (!handles) {
            throw new Error("正文图片写回必须绑定 Project Workspace");
        }

        for (let attempt = 0; attempt < maxRetries; attempt += 1) {
            const remote = await readChapterState(input.target.root, input.filePath);
            const matched = findTextToImagePromptMarkdown(remote.content, input.placeholderId);
            if (!matched) {
                const knownPaths = new Set([
                    ...(input.existingAssetPaths ?? []),
                    input.asset.relativePath,
                ]);
                const alreadyInserted = [...knownPaths].some((relativePath) => remote.content.includes(relativePath));
                return {
                    status: alreadyInserted ? "already_inserted" : "missing",
                    content: remote.content,
                    asset: input.asset,
                };
            }

            const nextContent = remote.content.replace(matched.raw, renderTextToImageAssetMarkdown(input.asset));
            const beforeWrite = await statWorkspacePath(input.target.root, input.filePath);
            if (beforeWrite.mtimeMs !== remote.node.mtimeMs) {
                continue;
            }

            await writeWorkspaceTextFileTracked({
                target: input.target,
                history: handles.history,
                filePath: input.filePath,
                content: nextContent,
                actor: USER_LOCAL_ACTOR,
                knownBefore: remote.content,
            });
            return {
                status: "inserted",
                content: nextContent,
                asset: input.asset,
            };
        }

        throw new BodyImageWritebackConflictError(input.filePath, maxRetries);
    });
}

export class BodyImageWritebackConflictError extends Error {
    readonly code = "body_image_writeback_conflict" as const;
    readonly statusCode = 409;

    constructor(filePath: string, attempts: number) {
        super(`正文在插入图片期间持续发生修改，已重试 ${attempts} 次：${filePath}`);
        this.name = "BodyImageWritebackConflictError";
    }
}

type ChapterState = {
    content: string;
    node: WorkspaceFileNode;
};

async function readChapterState(root: Extract<WorkspaceFileTarget, {kind: "project-workspace"}>["root"], filePath: string): Promise<ChapterState> {
    const [node, content] = await Promise.all([
        statWorkspacePath(root, filePath),
        readWorkspaceTextFile(root, filePath),
    ]);
    return {node, content};
}
